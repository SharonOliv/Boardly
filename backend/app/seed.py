"""Demo data:  python -m app.seed   →  login demo@boardly.dev / demo1234"""
from datetime import date, timedelta

from sqlalchemy import select

from . import models as m
from .auth import hash_pw
from .db import SessionLocal

db = SessionLocal()
if db.scalar(select(m.User).where(m.User.email == "demo@boardly.dev")):
    print("Demo data already exists.")
    raise SystemExit

people = {}
for name, email in [("Demo User", "demo@boardly.dev"), ("Asha Rao", "asha@boardly.dev"), ("Vikram Singh", "vikram@boardly.dev")]:
    u = m.User(name=name, email=email, password_hash=hash_pw("demo1234"))
    db.add(u)
    people[name] = u
db.flush()

ws = m.Workspace(name="Product Team")
db.add(ws)
db.flush()
for i, u in enumerate(people.values()):
    db.add(m.Membership(user_id=u.id, workspace_id=ws.id, role="owner" if i == 0 else "member"))

board = m.Board(workspace_id=ws.id, name="Website launch")
db.add(board)
db.flush()

today = date.today()
columns = {
    "To do": [
        ("Write launch announcement", "Draft the blog post and email copy.", "Asha Rao", 3, "high", "content,marketing"),
        ("Set up error monitoring", "", "Vikram Singh", 6, "medium", "backend"),
        ("Collect customer quotes", "Ask 5 beta users for a short quote.", None, None, "low", "marketing"),
    ],
    "In progress": [
        ("Design pricing page", "Three tiers, monthly/yearly toggle.", "Demo User", 2, "high", "design,frontend"),
        ("Fix mobile navigation bug", "Menu doesn't close after tapping a link.", "Vikram Singh", -1, "high", "frontend,bug"),
    ],
    "Done": [
        ("Choose domain name", "", "Demo User", None, "low", "ops"),
        ("Create brand colors", "", "Asha Rao", None, "medium", "design"),
    ],
}
cards = []
for i, (title, items) in enumerate(columns.items()):
    lst = m.BoardList(board_id=board.id, title=title, position=(i + 1) * 1000)
    db.add(lst)
    db.flush()
    for j, (t, d, who, due, pr, labels) in enumerate(items):
        c = m.Card(
            list_id=lst.id, title=t, description=d, position=(j + 1) * 1000, priority=pr, labels=labels,
            assignee_id=people[who].id if who else None,
            due_date=today + timedelta(days=due) if due is not None else None,
        )
        db.add(c)
        cards.append(c)
db.flush()
db.add(m.Comment(card_id=cards[3].id, user_id=people["Asha Rao"].id, body="Can we show the yearly discount more clearly?"))
db.add(m.Comment(card_id=cards[3].id, user_id=people["Demo User"].id, body="Yes. Adding a badge next to the toggle."))
db.add(m.Activity(board_id=board.id, user_id=people["Demo User"].id, text='created the board "Website launch"'))
db.commit()
print("Seeded. Sign in with demo@boardly.dev / demo1234")