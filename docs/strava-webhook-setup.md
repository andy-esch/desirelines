# Strava Webhook Setup Guide

This document covers the complete process for setting up Strava webhook subscriptions, including the critical OAuth2 authorization step that's often missed.

## Overview

Strava webhooks require three main steps:
1. **Create Strava API Application** - Register your app with Strava
2. **Authorize User Access** - OAuth2 flow to grant permissions ⭐ **CRITICAL STEP**
3. **Create Webhook Subscription** - Register callback URL for events

## Step 1: Create Strava API Application

1. Go to https://www.strava.com/settings/api
2. Create a new application
3. Note your **Client ID** and **Client Secret**
4. Set appropriate callback URLs for your application

## Step 2: Authorize User Access (OAuth2 Flow) ⭐ **REQUIRED**

**This step is critical and often missed!** Strava will not send webhooks until the user has authorized your application via OAuth2.

### Manual Authorization Process

1. **Generate authorization URL** ⚠️ **CRITICAL: Must include `activity:read_all` scope**:
   ```
   https://www.strava.com/oauth/authorize?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=YOUR_REDIRECT_URI&approval_prompt=force&scope=activity:read_all
   ```

2. **Visit the URL** in your browser while logged into the target Strava account

3. **Grant permissions** - Click "Authorize" to allow your application access
   - ⚠️ **VERIFY**: The authorization page should show "View data about your activities"
   - ❌ **If missing**: Webhooks will be created but NO events will be delivered

4. **Exchange code for tokens** (if you need refresh tokens):
   ```bash
   curl -X POST https://www.strava.com/oauth/token \
     -F client_id=YOUR_CLIENT_ID \
     -F client_secret=YOUR_CLIENT_SECRET \
     -F code=AUTHORIZATION_CODE \
     -F grant_type=authorization_code
   ```

### Key Points

- ⚠️ **CRITICAL**: Must include `scope=activity:read_all` in authorization URL
- ✅ **Must be done for each Strava account** that should trigger webhooks
- ✅ **Required even for your own account** as the app developer
- ✅ **Separate authorization needed** for dev and prod accounts
- ❌ **Webhooks won't work** without this authorization step
- ❌ **No error messages** - Strava silently ignores webhook events
- 🔍 **Easy to miss** - Wrong scope = working webhook setup but zero events

## Step 3: Create Webhook Subscription

After OAuth2 authorization, create the webhook subscription:

```bash
# Using our make command
make create-webhook dev  # or prod
```

## Environment-Specific Setup

### Development Environment
1. **Separate Strava account** - Use dedicated dev account
2. **OAuth2 authorization** - Authorize dev account for dev application
3. **Webhook subscription** - Point to dev Cloud Function endpoint
4. **Secret storage** - Store credentials in `strava-auth-dev` secret

### Production Environment
1. **Main Strava account** - Use your primary account
2. **OAuth2 authorization** - Authorize main account for prod application
3. **Webhook subscription** - Point to prod Cloud Function endpoint
4. **Secret storage** - Store credentials in `strava-auth-prod` secret

## Troubleshooting

### Webhooks Not Triggering

If webhooks aren't working, verify:

1. ✅ **Webhook subscription exists**: `make view-subscription dev`
2. ✅ **Function is reachable**: `curl https://your-function-url`
3. ✅ **OAuth2 authorization completed**: Check if you can access Strava API with your tokens
4. ✅ **Activity account matches**: Activities must be on the authorized account

### Common Issues

- **Missing `activity:read_all` scope**: ⭐ **MOST COMMON** - Webhook subscription works but no events delivered
  - **Symptom**: Webhook creates successfully, but no activity events trigger functions
  - **Solution**: Re-authorize with correct scope URL (see above)
  - **Check**: Strava API settings should show "View data about your activities" permission
- **Missing OAuth2**: Webhook subscription works but no events delivered
- **Account mismatch**: Activities on different account than authorized account
- **Token expiry**: Refresh tokens if API calls start failing

## Multi-User Support (Future)

For supporting multiple users, the OAuth2 flow becomes central:

1. **User Registration**: Each new user must complete OAuth2 authorization
2. **Token Management**: Store refresh tokens per user
3. **Webhook Routing**: Route webhook events to correct user context
4. **Permission Management**: Handle token refresh and revocation

### Planned Implementation

- [ ] **OAuth2 web flow** - User-friendly authorization interface
- [ ] **Token storage** - Per-user token management in database
- [ ] **Webhook multiplexing** - Route events based on owner_id
- [ ] **User dashboard** - Manage connections and permissions

## Security Notes

- **Never commit tokens** to version control
- **Use Secret Manager** for credential storage
- **Implement token refresh** for long-running applications
- **Validate webhook signatures** (future enhancement)

## References

- [Strava API Documentation](https://developers.strava.com/docs/)
- [OAuth2 Authorization](https://developers.strava.com/docs/authentication/)
- [Webhook Events](https://developers.strava.com/docs/webhooks/)
