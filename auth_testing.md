# PetBill Shield — Auth Testing Playbook

This app uses Emergent-managed Google OAuth.

## Step 1: Create Test User & Session
```bash
mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user.' + Date.now() + '@example.com',
  name: 'Test User',
  picture: 'https://via.placeholder.com/150',
  created_at: new Date().toISOString()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000).toISOString(),
  created_at: new Date().toISOString()
});
print('Session token: ' + sessionToken);
print('User ID: ' + userId);
"
```

## Step 2: Test Backend
```bash
curl -X GET "$BASE/api/auth/me" -H "Authorization: Bearer $TOKEN"
curl -X GET "$BASE/api/pets" -H "Authorization: Bearer $TOKEN"
curl -X POST "$BASE/api/pets" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"Mochi","species":"cat"}'
```

## Step 3: Browser Testing
```python
await page.context.add_cookies([{
  "name": "session_token",
  "value": "YOUR_SESSION_TOKEN",
  "domain": "your-app.com",
  "path": "/",
  "httpOnly": True,
  "secure": True,
  "sameSite": "None"
}])
await page.goto("https://your-app.com/dashboard")
```

## Success
- `/api/auth/me` returns user data
- `/dashboard` loads without redirect
- Pets CRUD works
- Estimate analyze returns structured JSON (or 401 without token)
