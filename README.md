@app.route('/api/reset-password', methods=['POST'])

def reset_password():

    data = request.get_json()
    
    email = data.get('email')
    
    code = data.get('code')
    
    new_password = data.get('new_password')
  

    if not all([email, code, new_password]):
  
        return jsonify({"error": "All fields (email, code, new_password) are required."}), 400
        

    db = get_db()
   
    cursor = db.cursor()
  
    cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
    user = cursor.fetchone()
    if not user:
        db.close()
        return jsonify({"error": "User not found."}), 404

    current_time = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    cursor.execute(
        """
        SELECT id FROM password_resets 
        WHERE user_id = ? AND code = ? AND expires_at > ?
        """, 
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
