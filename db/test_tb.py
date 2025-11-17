import mysql.connector

conn = mysql.connector.connect(
    host="ccscloud.dlsu.edu.ph",
    port=60827,                   # Node1 DB external port
    user="stadvdb42",
    password="MyStrongPass123!",
    database="stadvdb42",
)

cursor = conn.cursor()
cursor.execute("SELECT order_id, customer_id, region, order_date, amount FROM orders")
rows = cursor.fetchall()

for row in rows:
    print(row)

cursor.close()
conn.close()
