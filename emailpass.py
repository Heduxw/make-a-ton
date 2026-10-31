@app.route('/api/reset-password', methods=['POST'])
# -> Tells the server: "If a user submits data to '/api/reset-password', run this function."

def reset_password():
# -> Defines the function that processes the actual password modification.
    data = request.get_json()
    # -> Grabs the incoming data packet containing the fields typed into the form panels.
    email = data.get('email')
    # -> Extracts the user's email address from the packet.
    code = data.get('code')
    # -> Extracts the 6-digit number typed into the form panel by the user.
    new_password = data.get('new_password')
    # -> Extracts the brand new plaintext password typed into the form panel by the user.

    if not all([email, code, new_password]):
    # -> Safety check: "If any of these three items are empty or missing, trigger the error below."
        return jsonify({"error": "All fields (email, code, new_password) are required."}), 400
        # -> Rejects the request with a '400 Bad Request' error code.

    db = get_db()
    # -> Opens the database file.
    cursor = db.cursor()
    # -> Creates a pointer to run database queries.

    cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
    # -> Looks up the user's ID number again based on their email.
    user = cursor.fetchone()
    if not user:
        db.close()
        return jsonify({"error": "User not found."}), 404
        # -> If the user somehow disappeared or doesn't exist, stop and return '404 Not Found'.

    current_time = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    # -> Captures the exact clock time the user hit the submit button, formatted as text.

    cursor.execute(
        """
        SELECT id FROM password_resets 
        WHERE user_id = ? AND code = ? AND expires_at > ?
        """, 
        (user['id'], code, current_time)
    )
    # -> Strict security verification: "Is there a row matching this user ID, with this exact code, 
    #    where the expiration time is still greater than (in the future compared to) the current clock time?"
    
    valid_request = cursor.fetchone()
    # -> Fetches the confirmation row. If the code was wrong or expired, this variable will be empty.

    if not valid_request:
    # -> Reads as: "If the validation check failed because the code was wrong, used, or expired..."
        db.close()
        return jsonify({"error": "Invalid or expired verification code."}), 400
        # -> Rejects the password change with a '400 Bad Request' error code.

    hashed_password = generate_password_hash(new_password)
    # -> Scrambles the new password into a long, secure, unreadable string of hash characters.

    cursor.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hashed_password, user['id']))
    # -> Finds the user by their ID in the permanent 'users' table and completely overwrites their old password hash.

    cursor.execute("DELETE FROM password_resets WHERE user_id = ?", (user['id'],))
    # -> Instantly removes the 6-digit code from the database so it can never be recycled or used again.
    
    db.commit()
    # -> Saves all structural database changes permanently.
    db.close()
    # -> Closes the database connection file.

    return jsonify({"message": "Password updated successfully. Redirecting to login..."}), 200
    # -> Sends a successful '200 OK' response back, signaling the frontend to redirect the user to the login screen.
    