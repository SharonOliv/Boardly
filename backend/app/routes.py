from datetime import date, timezone

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import models as m
from .auth import current_user, hash_pw, make_token, user_from_token, verify_pw
from .db import SessionLocal, get_db
from .ws import hub

router = APIRouter()
PRIORITIES = ("low", "medium", "high")


# ───────────────────────── helpers ─────────────────────────
def clean(text: str | None, limit: int = 100) -> str:
    text = (text or "").strip()
    if not text:
        raise HTTPException(400, "This field can't be empty")
    return text[:limit]


def iso(dt) -> str:
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).isoformat()


def user_out(u: m.User) -> dict:
    return {"id": u.id, "name": u.name, "email": u.email}


def role_of(db: Session, user_id: int, wid: int) -> str | None:
    return db.scalar(
        select(m.Membership.role).where(
            m.Membership.user_id == user_id, m.Membership.workspace_id == wid
        )
    )


def require(db: Session, user: m.User, wid: int, write: bool = True) -> str:
    role = role_of(db, user.id, wid)
    if role is None:
        raise HTTPException(403, "You are not a member of this workspace")
    if write and role == "viewer":
        raise HTTPException(403, "Viewers have read-only access")
    return role


def board_or_404(db: Session, bid: int, user: m.User, write: bool = False) -> m.Board:
    board = db.get(m.Board, bid)
    if not board:
        raise HTTPException(404, "Board not found")
    require(db, user, board.workspace_id, write)
    return board


def list_or_404(db: Session, lid: int, user: m.User):
    lst = db.get(m.BoardList, lid)
    if not lst:
        raise HTTPException(404, "List not found")
    return lst, board_or_404(db, lst.board_id, user, write=True)


def card_or_404(db: Session, cid: int, user: m.User, write: bool = True):
    card = db.get(m.Card, cid)
    if not card:
        raise HTTPException(404, "Card not found")
    lst = db.get(m.BoardList, card.list_id)
    return card, board_or_404(db, lst.board_id, user, write)


def card_out(c: m.Card, comment_count: int = 0) -> dict:
    return {
        "id": c.id, "list_id": c.list_id, "title": c.title, "description": c.description,
        "position": c.position, "assignee_id": c.assignee_id,
        "due_date": c.due_date.isoformat() if c.due_date else None,
        "priority": c.priority, "labels": [x for x in c.labels.split(",") if x],
        "comment_count": comment_count,
    }


def members_of(db: Session, wid: int) -> list[dict]:
    rows = db.execute(
        select(m.User, m.Membership.role)
        .join(m.Membership, m.Membership.user_id == m.User.id)
        .where(m.Membership.workspace_id == wid)
        .order_by(m.User.name)
    ).all()
    return [{**user_out(u), "role": r} for u, r in rows]


async def emit(db: Session, board_id: int, user: m.User, type_: str, text: str | None = None, **data):
    """Optionally write to the activity log, then push the event to everyone on the board."""
    if text:
        db.add(m.Activity(board_id=board_id, user_id=user.id, text=text[:400]))
        db.commit()
    await hub.broadcast(board_id, {"type": type_, "by": user.id, **data})


class NameIn(BaseModel):
    name: str


# ───────────────────────── auth ─────────────────────────
class SignupIn(BaseModel):
    email: str
    name: str
    password: str


@router.post("/auth/signup")
def signup(data: SignupIn, db: Session = Depends(get_db)):
    email = data.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(400, "Enter a valid email address")
    if len(data.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    if db.scalar(select(m.User).where(m.User.email == email)):
        raise HTTPException(400, "An account with this email already exists")
    user = m.User(email=email, name=clean(data.name), password_hash=hash_pw(data.password))
    db.add(user)
    db.commit()
    return {"access_token": make_token(user.id), "user": user_out(user)}


@router.post("/auth/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.scalar(select(m.User).where(m.User.email == form.username.strip().lower()))
    if not user or not verify_pw(form.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    return {"access_token": make_token(user.id), "user": user_out(user)}


@router.get("/auth/me")
def me(user: m.User = Depends(current_user)):
    return user_out(user)


# ───────────────────────── workspaces ─────────────────────────
@router.get("/workspaces")
def my_workspaces(db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    rows = db.execute(
        select(m.Workspace, m.Membership.role)
        .join(m.Membership, m.Membership.workspace_id == m.Workspace.id)
        .where(m.Membership.user_id == user.id)
        .order_by(m.Workspace.id)
    ).all()
    out = []
    for ws, role in rows:
        count = db.scalar(
            select(func.count()).select_from(m.Membership).where(m.Membership.workspace_id == ws.id)
        )
        out.append({
            "id": ws.id, "name": ws.name, "role": role, "member_count": count,
            "boards": [{"id": b.id, "name": b.name} for b in ws.boards],
        })
    return out


@router.post("/workspaces")
def create_workspace(data: NameIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    ws = m.Workspace(name=clean(data.name))
    db.add(ws)
    db.flush()
    db.add(m.Membership(user_id=user.id, workspace_id=ws.id, role="owner"))
    db.commit()
    return {"id": ws.id, "name": ws.name, "role": "owner", "member_count": 1, "boards": []}


@router.get("/workspaces/{wid}/members")
def list_members(wid: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    require(db, user, wid, write=False)
    return members_of(db, wid)


class InviteIn(BaseModel):
    email: str
    role: str = "member"


@router.post("/workspaces/{wid}/members")
def invite_member(wid: int, data: InviteIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    if require(db, user, wid) != "owner":
        raise HTTPException(403, "Only workspace owners can invite people")
    if data.role not in ("member", "viewer"):
        raise HTTPException(400, "Role must be member or viewer")
    target = db.scalar(select(m.User).where(m.User.email == data.email.strip().lower()))
    if not target:
        raise HTTPException(404, "No Boardly account uses that email. Ask them to sign up first.")
    if role_of(db, target.id, wid):
        raise HTTPException(400, f"{target.name} is already in this workspace")
    db.add(m.Membership(user_id=target.id, workspace_id=wid, role=data.role))
    db.commit()
    return members_of(db, wid)


# ───────────────────────── boards ─────────────────────────
@router.post("/workspaces/{wid}/boards")
def create_board(wid: int, data: NameIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    require(db, user, wid)
    board = m.Board(workspace_id=wid, name=clean(data.name))
    db.add(board)
    db.flush()
    for i, title in enumerate(["To do", "In progress", "Done"]):
        db.add(m.BoardList(board_id=board.id, title=title, position=(i + 1) * 1000))
    db.commit()
    return {"id": board.id, "name": board.name}


@router.get("/boards/{bid}")
def get_board(bid: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    board = board_or_404(db, bid, user)
    ws = db.get(m.Workspace, board.workspace_id)
    ids = [c.id for lst in board.lists for c in lst.cards]
    counts = {}
    if ids:
        counts = dict(
            db.execute(
                select(m.Comment.card_id, func.count()).where(m.Comment.card_id.in_(ids)).group_by(m.Comment.card_id)
            ).all()
        )
    return {
        "id": board.id, "name": board.name,
        "workspace": {"id": ws.id, "name": ws.name},
        "role": role_of(db, user.id, ws.id),
        "members": members_of(db, ws.id),
        "lists": [
            {"id": lst.id, "title": lst.title, "position": lst.position,
             "cards": [card_out(c, counts.get(c.id, 0)) for c in lst.cards]}
            for lst in board.lists
        ],
    }


@router.delete("/boards/{bid}")
async def delete_board(bid: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    board = board_or_404(db, bid, user, write=True)
    if role_of(db, user.id, board.workspace_id) != "owner":
        raise HTTPException(403, "Only workspace owners can delete boards")
    db.delete(board)
    db.commit()
    await hub.broadcast(bid, {"type": "board_deleted", "by": user.id})
    return {"ok": True}


@router.get("/boards/{bid}/activity")
def board_activity(bid: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    board_or_404(db, bid, user)
    rows = db.execute(
        select(m.Activity, m.User.name)
        .join(m.User, m.User.id == m.Activity.user_id)
        .where(m.Activity.board_id == bid)
        .order_by(m.Activity.id.desc())
        .limit(50)
    ).all()
    return [{"id": a.id, "user": n, "text": a.text, "created_at": iso(a.created_at)} for a, n in rows]


# ───────────────────────── lists ─────────────────────────
class TitleIn(BaseModel):
    title: str


@router.post("/boards/{bid}/lists")
async def create_list(bid: int, data: TitleIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    board = board_or_404(db, bid, user, write=True)
    last = db.scalar(select(func.max(m.BoardList.position)).where(m.BoardList.board_id == bid)) or 0
    lst = m.BoardList(board_id=bid, title=clean(data.title), position=last + 1000)
    db.add(lst)
    db.commit()
    await emit(db, board.id, user, "list_changed", f'added list "{lst.title}"')
    return {"id": lst.id, "title": lst.title, "position": lst.position, "cards": []}


@router.patch("/lists/{lid}")
async def rename_list(lid: int, data: TitleIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    lst, board = list_or_404(db, lid, user)
    old, lst.title = lst.title, clean(data.title)
    db.commit()
    await emit(db, board.id, user, "list_changed", f'renamed list "{old}" to "{lst.title}"')
    return {"ok": True}


@router.delete("/lists/{lid}")
async def delete_list(lid: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    lst, board = list_or_404(db, lid, user)
    title = lst.title
    db.delete(lst)
    db.commit()
    await emit(db, board.id, user, "list_changed", f'deleted list "{title}"')
    return {"ok": True}


# ───────────────────────── cards ─────────────────────────
@router.post("/lists/{lid}/cards")
async def create_card(lid: int, data: TitleIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    lst, board = list_or_404(db, lid, user)
    last = db.scalar(select(func.max(m.Card.position)).where(m.Card.list_id == lid)) or 0
    card = m.Card(list_id=lid, title=clean(data.title, 200), position=last + 1000)
    db.add(card)
    db.commit()
    await emit(db, board.id, user, "card_created", f'added "{card.title}" to {lst.title}', card_id=card.id)
    return card_out(card)


@router.get("/cards/{cid}")
def get_card(cid: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    card, _ = card_or_404(db, cid, user, write=False)
    rows = db.execute(
        select(m.Comment, m.User)
        .join(m.User, m.User.id == m.Comment.user_id)
        .where(m.Comment.card_id == cid)
        .order_by(m.Comment.id)
    ).all()
    comments = [
        {"id": c.id, "body": c.body, "created_at": iso(c.created_at), "user": user_out(u)}
        for c, u in rows
    ]
    return {**card_out(card, len(comments)), "comments": comments}


class CardPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    assignee_id: int | None = None
    due_date: date | None = None
    priority: str | None = None
    labels: list[str] | None = None


FIELD_NAMES = {
    "title": "title", "description": "description", "assignee_id": "assignee",
    "due_date": "due date", "priority": "priority", "labels": "labels",
}


@router.patch("/cards/{cid}")
async def update_card(cid: int, data: CardPatch, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    card, board = card_or_404(db, cid, user)
    sent, before = data.model_fields_set, card_out(card)
    if "title" in sent:
        card.title = clean(data.title, 200)
    if "description" in sent:
        card.description = (data.description or "")[:5000]
    if "assignee_id" in sent:
        if data.assignee_id is not None and role_of(db, data.assignee_id, board.workspace_id) is None:
            raise HTTPException(400, "Assignee must be a workspace member")
        card.assignee_id = data.assignee_id
    if "due_date" in sent:
        card.due_date = data.due_date
    if "priority" in sent:
        if data.priority not in PRIORITIES:
            raise HTTPException(400, "Priority must be low, medium or high")
        card.priority = data.priority
    if "labels" in sent:
        card.labels = ",".join(dict.fromkeys(x.strip()[:20] for x in (data.labels or []) if x.strip()))[:300]
    after = card_out(card)
    changed = [FIELD_NAMES[k] for k in FIELD_NAMES if before[k] != after[k]]
    if changed:
        db.commit()
        await emit(db, board.id, user, "card_updated",
                   f'updated {", ".join(changed)} on "{card.title}"', card_id=card.id)
    return after


class MoveIn(BaseModel):
    list_id: int
    position: float


@router.patch("/cards/{cid}/move")
async def move_card(cid: int, data: MoveIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    card, board = card_or_404(db, cid, user)
    dest = db.get(m.BoardList, data.list_id)
    if not dest or dest.board_id != board.id:
        raise HTTPException(400, "Destination list is not on this board")
    changed_list = card.list_id != dest.id
    card.list_id, card.position = dest.id, data.position
    db.commit()
    text = f'moved "{card.title}" to {dest.title}' if changed_list else None
    await emit(db, board.id, user, "card_moved", text, card_id=card.id)
    return {"ok": True}


@router.delete("/cards/{cid}")
async def delete_card(cid: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    card, board = card_or_404(db, cid, user)
    title = card.title
    db.delete(card)
    db.commit()
    await emit(db, board.id, user, "card_deleted", f'deleted "{title}"', card_id=cid)
    return {"ok": True}


# ───────────────────────── comments ─────────────────────────
class CommentIn(BaseModel):
    body: str


@router.post("/cards/{cid}/comments")
async def add_comment(cid: int, data: CommentIn, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    card, board = card_or_404(db, cid, user)
    comment = m.Comment(card_id=cid, user_id=user.id, body=clean(data.body, 2000))
    db.add(comment)
    db.commit()
    await emit(db, board.id, user, "comment_added", f'commented on "{card.title}"', card_id=cid)
    return {"id": comment.id}


@router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: int, db: Session = Depends(get_db), user: m.User = Depends(current_user)):
    comment = db.get(m.Comment, comment_id)
    if not comment:
        raise HTTPException(404, "Comment not found")
    if comment.user_id != user.id:
        raise HTTPException(403, "You can only delete your own comments")
    card, board = card_or_404(db, comment.card_id, user)
    db.delete(comment)
    db.commit()
    await emit(db, board.id, user, "comment_added", card_id=card.id)
    return {"ok": True}


# ───────────────────────── realtime ─────────────────────────
@router.websocket("/ws/boards/{bid}")
async def board_socket(ws: WebSocket, bid: int, token: str = ""):
    db = SessionLocal()
    try:
        user = user_from_token(token, db)
        board_or_404(db, bid, user)
        info = {"id": user.id, "name": user.name}
    except HTTPException:
        await ws.close(code=4401)
        return
    finally:
        db.close()

    await hub.connect(bid, ws, info)
    try:
        while True:
            msg = await ws.receive_json()
            if msg.get("type") == "typing":  # ephemeral: never stored
                await hub.broadcast(
                    bid, {"type": "typing", "user": info, "card_id": msg.get("card_id")}, exclude=ws
                )
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await hub.disconnect(bid, ws)