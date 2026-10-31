import random
import datetime
import sqlite3
from flask import Flask, request, jsonify
from werkzeug.security import generate_password_hash

app = Flask(__name__)

def get_db():
    conn = sqlite3.connect('users.db')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/api/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json()
    email = data.get('email')

    if not email:
        return jsonify({"error": "Email is required"}), 400

    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
    user = cursor.fetchone()

    if not user:
        db.close()
        return jsonify({"error": "This email is not registered."}), 404

    verification_code = str(random.randint(100000, 999999))
    expires_at = datetime.datetime.now() + datetime.timedelta(minutes=10)

    cursor.execute("DELETE FROM password_resets WHERE user_id = ?", (user['id'],))
    cursor.execute(
        "INSERT INTO password_resets (user_id, code, expires_at) VALUES (?, ?, ?)",
        (user['id'], verification_code, expires_at.strftime('%Y-%m-%d %H:%M:%S'))
    )
    db.commit()
    db.close()

    print(f"Code for {email} is {verification_code}")
    return jsonify({"message": "Verification code sent successfully to your email."}), 200

@app.route('/api/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json()
    email = data.get('email')
    code = data.get('code')
    new_password = data.get('new_password')

    if not all([email, code, new_password]):
        return jsonify({"error": "All fields are required."}), 400

    db = get_db()
    cursor = db.cursor()

    cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
    user = cursor.fetchone()
    if not user:
        db.close()
        return jsonify({"error": "User not found."}), 404

    current_time = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    cursor.execute(
        "SELECT id FROM password_resets WHERE user_id = ? AND code = ? AND expires_at > ?", 
        (user['id'], code, current_time)
    )
    valid_request = cursor.fetchone()

    if not valid_request:
        db.close()
        return jsonify({"error": "Invalid or expired verification code."}), 400

    hashed_password = generate_password_hash(new_password)
    cursor.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hashed_password, user['id']))
    cursor.execute("DELETE FROM password_resets WHERE user_id = ?", (user['id'],))
    db.commit()
    db.close()

    return jsonify({"message": "Password updated successfully. Redirecting to login..."}), 200

if __name__ == '__main__':
    app.run(debug=True)

