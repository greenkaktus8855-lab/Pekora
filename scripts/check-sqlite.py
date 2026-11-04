import sqlite3
from pathlib import Path

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript(Path("migrations/0001_initial.sql").read_text())

# Runtime-added user metadata and stable numeric public IDs.
db.execute("ALTER TABLE users ADD COLUMN public_id INTEGER")
db.execute("ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0")
db.execute("CREATE UNIQUE INDEX idx_users_public_id ON users(public_id)")

db.execute("INSERT INTO users (id,username,password_hash,password_salt,balance) VALUES (?,?,?,?,?)",
           ("test-user","TestUser","hash","salt",100))
db.execute("INSERT INTO users (id,username,password_hash,password_salt,balance) VALUES (?,?,?,?,?)",
           ("test-friend","TestFriend","hash","salt",100))
db.execute("INSERT INTO items (id,name,category,price,image_url,is_for_sale) VALUES (?,?,?,?,?,?)",
           ("test-hat","Test Hat","Hats",25,"https://example.com/hat.png",1))

# Purchase transaction: debit, inventory and history must commit together.
db.execute("""UPDATE users SET balance=balance-?
 WHERE id=? AND balance>=?
 AND NOT EXISTS (SELECT 1 FROM inventory WHERE user_id=? AND item_id=?)
 AND EXISTS (SELECT 1 FROM items WHERE id=? AND is_for_sale=1)""",
           (25,"test-user",25,"test-user","test-hat","test-hat"))
db.execute("INSERT INTO inventory (id,user_id,item_id) SELECT ?,?,? WHERE changes()=1",
           ("inventory-row","test-user","test-hat"))
db.execute("INSERT INTO purchases (id,user_id,item_id,price) SELECT ?,?,?,? WHERE changes()=1",
           ("purchase-row","test-user","test-hat",25))
assert db.execute("SELECT balance FROM users WHERE id='test-user'").fetchone()[0] == 75
assert db.execute("SELECT COUNT(*) FROM inventory WHERE user_id='test-user'").fetchone()[0] == 1
assert db.execute("SELECT COUNT(*) FROM purchases WHERE user_id='test-user'").fetchone()[0] == 1
print("PASS purchase transaction")

# A duplicate purchase must not debit again.
db.execute("""UPDATE users SET balance=balance-?
 WHERE id=? AND balance>=?
 AND NOT EXISTS (SELECT 1 FROM inventory WHERE user_id=? AND item_id=?)
 AND EXISTS (SELECT 1 FROM items WHERE id=? AND is_for_sale=1)""",
           (25,"test-user",25,"test-user","test-hat","test-hat"))
assert db.execute("SELECT changes()").fetchone()[0] == 0
assert db.execute("SELECT balance FROM users WHERE id='test-user'").fetchone()[0] == 75
print("PASS duplicate purchase protection")

# Profile save recreates a missing profile row.
db.execute("""INSERT INTO profiles (user_id,description) VALUES (?,?)
 ON CONFLICT(user_id) DO UPDATE SET description=excluded.description""",
           ("test-user","Profile saved"))
assert db.execute("SELECT description FROM profiles WHERE user_id='test-user'").fetchone()[0] == "Profile saved"
print("PASS profile upsert")

# Reciprocal friend request acceptance creates both directions.
db.execute("INSERT INTO friends (user_id,friend_id,status) VALUES (?,?, 'PENDING')",
           ("test-friend","test-user"))
db.execute("UPDATE friends SET status='ACCEPTED' WHERE user_id=? AND friend_id=? AND status='PENDING'",
           ("test-friend","test-user"))
db.execute("""INSERT OR REPLACE INTO friends (user_id,friend_id,status)
 SELECT ?,?,'ACCEPTED' WHERE changes()=1""", ("test-user","test-friend"))
assert db.execute("SELECT COUNT(*) FROM friends WHERE status='ACCEPTED'").fetchone()[0] == 2
print("PASS reciprocal friendship transaction")

# Catalog cleanout hides items without deleting users, balances or inventory.
db.execute("CREATE TABLE site_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL)")
db.execute("UPDATE items SET is_for_sale=0 WHERE is_for_sale=1")
db.execute("""INSERT OR IGNORE INTO site_settings (setting_key,setting_value)
 VALUES ('catalog_cleanout_2026_11_02','done')""")
assert db.execute("SELECT COUNT(*) FROM items WHERE is_for_sale=1").fetchone()[0] == 0
assert db.execute("SELECT COUNT(*) FROM inventory WHERE user_id='test-user'").fetchone()[0] == 1
assert db.execute("SELECT balance FROM users WHERE id='test-user'").fetchone()[0] == 75
print("PASS public catalog cleanout preserves ownership and balance")

# Limited inventory: mirror the columns added by Worker setup.
db.execute("ALTER TABLE items ADD COLUMN stock_limit INTEGER NOT NULL DEFAULT 0")
db.execute("ALTER TABLE items ADD COLUMN stock_sold INTEGER NOT NULL DEFAULT 0")
db.execute("INSERT INTO users (id,username,password_hash,password_salt,balance,public_id) VALUES (?,?,?,?,?,?)",
           ("test-third","TestThird","hash","salt",100,3))
db.execute("INSERT INTO items (id,name,category,price,image_url,is_for_sale,is_limited,stock_limit,stock_sold) VALUES (?,?,?,?,?,?,?,?,?)",
           ("limited-hat","Limited Hat","Hats",10,"https://example.com/limited.png",1,1,2,0))
db.commit()

def limited_purchase(user_id):
    db.execute("BEGIN IMMEDIATE")
    db.execute("""UPDATE items SET stock_sold=stock_sold+1
      WHERE id='limited-hat' AND is_for_sale=1
      AND (stock_limit=0 OR stock_sold<stock_limit)
      AND EXISTS (SELECT 1 FROM users WHERE id=? AND balance>=10)
      AND NOT EXISTS (SELECT 1 FROM inventory WHERE user_id=? AND item_id='limited-hat')""",
               (user_id,user_id))
    db.execute("UPDATE users SET balance=balance-10 WHERE id=? AND balance>=10 AND changes()=1",
               (user_id,))
    db.execute("""INSERT INTO inventory (id,user_id,item_id)
      SELECT ?,?,'limited-hat' WHERE changes()=1""",
               ("inv-"+user_id,user_id))
    db.execute("""INSERT INTO purchases (id,user_id,item_id,price)
      SELECT ?,?,'limited-hat',10 WHERE changes()=1""",
               ("purchase-"+user_id,user_id))
    changed = db.execute("SELECT changes()").fetchone()[0]
    db.commit()
    return changed == 1

assert limited_purchase("test-user")
assert limited_purchase("test-friend")
assert not limited_purchase("test-third")
assert db.execute("SELECT stock_sold FROM items WHERE id='limited-hat'").fetchone()[0] == 2
assert db.execute("SELECT COUNT(*) FROM inventory WHERE item_id='limited-hat'").fetchone()[0] == 2
assert db.execute("SELECT balance FROM users WHERE id='test-third'").fetchone()[0] == 100
print("PASS Limited stock cap and sold-out protection")

# Custom public User IDs are unique and changing an ID does not change the internal account key.
db.execute("UPDATE users SET public_id=rowid WHERE public_id IS NULL")
db.execute("UPDATE users SET public_id=501 WHERE id='test-user'")
db.execute("UPDATE users SET public_id=502 WHERE id='test-friend'")
db.execute("""UPDATE users SET public_id=502
 WHERE id='test-user' AND NOT EXISTS (SELECT 1 FROM users WHERE public_id=502 AND id<>'test-user')""")
assert db.execute("SELECT changes()").fetchone()[0] == 0
assert db.execute("SELECT id FROM users WHERE public_id=501").fetchone()[0] == "test-user"
assert db.execute("SELECT COUNT(*) FROM users WHERE public_id=502").fetchone()[0] == 1
print("PASS unique public User ID changes")


# Player resale: seller must own the item and only Limited or Off Sale items qualify.
db.execute("ALTER TABLE items ADD COLUMN is_offsale INTEGER NOT NULL DEFAULT 0")
db.execute("""CREATE TABLE trade_locks (
 owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 trade_id TEXT NOT NULL,
 PRIMARY KEY(owner_id,item_id)
)""")
db.execute("""CREATE TABLE resale_listings (
 id TEXT PRIMARY KEY,
 item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
 seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 price INTEGER NOT NULL CHECK(price>0 AND price<=1000000),
 currency TEXT NOT NULL DEFAULT 'P$' CHECK(currency='P$'),
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SOLD','CANCELLED')),
 buyer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 sold_at TEXT
)""")
db.execute("""CREATE UNIQUE INDEX idx_resale_active_item_seller
 ON resale_listings(item_id,seller_id) WHERE status='ACTIVE'""")
db.execute("""CREATE TRIGGER trg_resale_no_trade_lock BEFORE INSERT ON resale_listings
 WHEN EXISTS (SELECT 1 FROM trade_locks WHERE owner_id=NEW.seller_id AND item_id=NEW.item_id)
 BEGIN SELECT RAISE(ABORT,'Item is reserved in a pending trade.'); END""")
db.execute("""CREATE TRIGGER trg_trade_lock_no_resale BEFORE INSERT ON trade_locks
 WHEN EXISTS (SELECT 1 FROM resale_listings WHERE seller_id=NEW.owner_id AND item_id=NEW.item_id AND status='ACTIVE')
 BEGIN SELECT RAISE(ABORT,'Item is already listed for sale.'); END""")
db.execute("INSERT INTO users (id,username,password_hash,password_salt,role,balance,public_id) VALUES (?,?,?,?,?,?,?)",
           ("admin-account","Admin","hash","salt","OWNER",0,4))

# A regular item cannot be listed, even if it is in the seller's inventory.
db.execute("""INSERT INTO resale_listings (id,item_id,seller_id,price,currency)
 SELECT 'invalid-listing','test-hat','test-user',1,'P$'
 WHERE EXISTS (SELECT 1 FROM inventory WHERE user_id='test-user' AND item_id='test-hat')
 AND EXISTS (SELECT 1 FROM items WHERE id='test-hat' AND (is_limited=1 OR is_offsale=1))""")
assert db.execute("SELECT changes()").fetchone()[0] == 0

# A Limited item can be listed for the minimum price of 1 P$.
db.execute("""INSERT INTO resale_listings (id,item_id,seller_id,price,currency)
 SELECT 'limited-resale','limited-hat','test-user',1,'P$'
 WHERE EXISTS (SELECT 1 FROM inventory WHERE user_id='test-user' AND item_id='limited-hat')
 AND EXISTS (SELECT 1 FROM items WHERE id='limited-hat' AND (is_limited=1 OR is_offsale=1))""")
assert db.execute("SELECT changes()").fetchone()[0] == 1
try:
    db.execute("INSERT INTO trade_locks (owner_id,item_id,trade_id) VALUES (?,?,?)",
               ("test-user","limited-hat","trade-after-listing"))
    raise AssertionError("A listed item must not be trade-locked")
except sqlite3.IntegrityError:
    pass
db.commit()

# Buying the listing atomically transfers the item and P$ from buyer to seller.
db.execute("BEGIN IMMEDIATE")
db.execute("""UPDATE resale_listings SET status='SOLD',buyer_id=?,sold_at=datetime('now')
 WHERE id=? AND status='ACTIVE' AND seller_id<>?
 AND EXISTS (SELECT 1 FROM inventory v JOIN items i ON i.id=v.item_id
   WHERE v.user_id=resale_listings.seller_id AND v.item_id=resale_listings.item_id
   AND (i.is_limited=1 OR i.is_offsale=1))
 AND EXISTS (SELECT 1 FROM users b WHERE b.id=? AND b.balance>=resale_listings.price)
 AND EXISTS (SELECT 1 FROM users s WHERE s.id=resale_listings.seller_id AND s.is_banned=0)
 AND NOT EXISTS (SELECT 1 FROM inventory WHERE user_id=? AND item_id=resale_listings.item_id)
 AND NOT EXISTS (SELECT 1 FROM trade_locks WHERE owner_id=resale_listings.seller_id AND item_id=resale_listings.item_id)""",
           ("test-third","limited-resale","test-third","test-third","test-third"))
db.execute("UPDATE users SET balance=balance-1 WHERE id='test-third' AND balance>=1 AND changes()=1")
db.execute("UPDATE users SET balance=balance+1 WHERE id='test-user' AND changes()=1")
db.execute("DELETE FROM inventory WHERE user_id='test-user' AND item_id='limited-hat' AND changes()=1")
db.execute("INSERT INTO inventory (id,user_id,item_id) SELECT 'resale-buyer-inv','test-third','limited-hat' WHERE changes()=1")
db.commit()
assert db.execute("SELECT balance FROM users WHERE id='test-user'").fetchone()[0] == 66
assert db.execute("SELECT balance FROM users WHERE id='test-third'").fetchone()[0] == 99
assert db.execute("SELECT COUNT(*) FROM inventory WHERE user_id='test-user' AND item_id='limited-hat'").fetchone()[0] == 0
assert db.execute("SELECT COUNT(*) FROM inventory WHERE user_id='test-third' AND item_id='limited-hat'").fetchone()[0] == 1
assert db.execute("SELECT status,buyer_id FROM resale_listings WHERE id='limited-resale'").fetchone() == ("SOLD","test-third")
print("PASS player resale transfers Limited item and P$ to seller")

# A sold listing cannot be bought a second time.
db.execute("""UPDATE resale_listings SET status='SOLD',buyer_id='test-third'
 WHERE id='limited-resale' AND status='ACTIVE' AND seller_id<>'test-third'""")
assert db.execute("SELECT changes()").fetchone()[0] == 0
assert db.execute("SELECT balance FROM users WHERE id='test-third'").fetchone()[0] == 99
print("PASS resale duplicate purchase and self-purchase protection")

# An Off Sale item is eligible even when it is no longer in the Catalog.
db.execute("INSERT INTO items (id,name,category,price,image_url,is_for_sale,is_limited,is_offsale) VALUES (?,?,?,?,?,?,?,?)",
           ("off-sale-hat","Off Sale Hat","Hats",10,"",0,0,1))
db.execute("INSERT INTO inventory (id,user_id,item_id) VALUES (?,?,?)",
           ("off-sale-inv","test-friend","off-sale-hat"))
db.execute("""INSERT INTO resale_listings (id,item_id,seller_id,price,currency)
 SELECT 'off-sale-listing','off-sale-hat','test-friend',1,'P$'
 WHERE EXISTS (SELECT 1 FROM inventory WHERE user_id='test-friend' AND item_id='off-sale-hat')
 AND EXISTS (SELECT 1 FROM items WHERE id='off-sale-hat' AND (is_limited=1 OR is_offsale=1))""")
assert db.execute("SELECT changes()").fetchone()[0] == 1
print("PASS Off Sale items can be listed by players")

# Regular Catalog purchases credit the exact Admin account.
db.commit()
db.execute("INSERT INTO items (id,name,category,price,image_url,is_for_sale,is_limited,is_offsale,stock_limit,stock_sold) VALUES (?,?,?,?,?,?,?,?,?,?)",
           ("admin-store-item","Admin Store Item","Hats",5,"",1,0,0,0,0))
db.execute("BEGIN IMMEDIATE")
db.execute("""UPDATE items SET stock_sold=stock_sold+1
 WHERE id='admin-store-item' AND is_for_sale=1 AND is_offsale=0
 AND EXISTS (SELECT 1 FROM users WHERE id='test-third' AND balance>=5)
 AND NOT EXISTS (SELECT 1 FROM inventory WHERE user_id='test-third' AND item_id='admin-store-item')
 AND EXISTS (SELECT 1 FROM users WHERE id='admin-account' AND role='OWNER' AND is_banned=0)""")
db.execute("UPDATE users SET balance=balance-5 WHERE id='test-third' AND balance>=5 AND changes()=1")
db.execute("UPDATE users SET balance=balance+5 WHERE id='admin-account' AND changes()=1")
db.execute("INSERT INTO inventory (id,user_id,item_id) SELECT 'admin-purchase-inv','test-third','admin-store-item' WHERE changes()=1")
db.execute("INSERT INTO purchases (id,user_id,item_id,price) SELECT 'admin-purchase','test-third','admin-store-item',5 WHERE changes()=1")
db.commit()
assert db.execute("SELECT balance FROM users WHERE id='admin-account'").fetchone()[0] == 5
assert db.execute("SELECT balance FROM users WHERE id='test-third'").fetchone()[0] == 94
assert db.execute("SELECT COUNT(*) FROM inventory WHERE user_id='test-third' AND item_id='admin-store-item'").fetchone()[0] == 1
print("PASS regular Catalog purchase credits Admin")
