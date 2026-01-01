# Migratorrr - Railway Deployment Guide

This guide walks you through deploying Migratorrr to Railway.

## Prerequisites

Before deploying, you'll need:

1. **Railway Account** - Sign up at [railway.app](https://railway.app)
2. **Helius API Key** - Get from [dev.helius.xyz](https://dev.helius.xyz) (free Developer plan works)
3. **Platform Fee Wallet** - A Solana wallet address you control for receiving fees

## Architecture Overview

Migratorrr consists of 4 services on Railway:

```
┌─────────────────────────────────────────────────────────────┐
│                      Railway Project                         │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌──────────┐  ┌────────┐ │
│  │   Server    │  │     Web     │  │ Postgres │  │ Redis  │ │
│  │  (Fastify)  │  │  (Next.js)  │  │    16    │  │   7    │ │
│  │  Port 3001  │  │  Port 3000  │  │          │  │        │ │
│  └─────────────┘  └─────────────┘  └──────────┘  └────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Step-by-Step Deployment

### Step 1: Create Railway Project

1. Go to [railway.app/new](https://railway.app/new)
2. Click **"Empty Project"**
3. Name your project (e.g., "migratorrr-production")

### Step 2: Add PostgreSQL Database

1. In your project, click **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Railway will automatically provision the database
3. Note: The `DATABASE_URL` variable is automatically created

### Step 3: Add Redis

1. Click **"+ New"** → **"Database"** → **"Redis"**
2. Railway will automatically provision Redis
3. Note: The `REDIS_URL` variable is automatically created

### Step 4: Deploy Server

1. Click **"+ New"** → **"GitHub Repo"**
2. Select your Migratorrr repository
3. **Important:** Set the root directory to `apps/server`
   - Go to Service Settings → Source → Root Directory → Enter `apps/server`
4. Railway will detect `railway.toml` and configure automatically

#### Server Environment Variables

Go to your Server service → **Variables** tab and add:

```bash
# Required - Generate with: openssl rand -hex 32
MASTER_ENCRYPTION_KEY=<generate-64-char-hex>
JWT_SECRET=<generate-64-char-hex>
ADMIN_SECRET=<generate-64-char-hex>

# Required - Your API keys
HELIUS_API_KEY=<your-helius-api-key>
PLATFORM_FEE_WALLET=<your-solana-wallet-address>

# Required - Set after web is deployed
CORS_ORIGIN=https://your-web-domain.up.railway.app

# Reference database variables (Railway injects these automatically if you link services)
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}

# Optional but recommended
NODE_ENV=production
LOG_LEVEL=info
BACKUP_RPC_URL=https://api.mainnet-beta.solana.com
PLATFORM_FEE_BPS=100
```

**Generate secrets using:**
```bash
openssl rand -hex 32
```

### Step 5: Deploy Web

1. Click **"+ New"** → **"GitHub Repo"**
2. Select your Migratorrr repository (same repo)
3. **Important:** Set the root directory to `apps/web`
   - Go to Service Settings → Source → Root Directory → Enter `apps/web`

#### Web Environment Variables

Go to your Web service → **Variables** tab and add:

```bash
# Point to your server's public URL
NEXT_PUBLIC_API_URL=https://your-server-domain.up.railway.app
NEXT_PUBLIC_SOCKET_URL=https://your-server-domain.up.railway.app
NEXT_PUBLIC_RPC_URL=https://api.mainnet-beta.solana.com
```

### Step 6: Connect Services to Databases

For both Server and Web services:
1. Go to the service → **Settings** → **Networking**
2. Under "Service connections," link to PostgreSQL and Redis
3. This allows using `${{Postgres.DATABASE_URL}}` references

### Step 7: Generate Domains

For both Server and Web:
1. Go to service → **Settings** → **Networking**
2. Click **"Generate Domain"**
3. Note down both URLs

### Step 8: Update CORS

After getting the Web domain:
1. Go to Server service → **Variables**
2. Update `CORS_ORIGIN` to your Web's domain (e.g., `https://migratorrr-web.up.railway.app`)
3. Redeploy the server

### Step 9: Update Web Environment

After getting the Server domain:
1. Go to Web service → **Variables**
2. Set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SOCKET_URL` to your Server's domain
3. Redeploy the web app

## Custom Domain Setup (Optional)

To use your own domain (e.g., `app.migratorrr.io`):

1. Go to Web service → **Settings** → **Networking**
2. Click **"Custom Domain"**
3. Add your domain (e.g., `app.migratorrr.io`)
4. Add the DNS records Railway provides to your domain registrar:
   - Type: CNAME
   - Name: `app` (or `@` for root)
   - Value: `<provided-by-railway>.up.railway.app`

For the API (optional - you can use Railway's domain):
1. Add a custom domain to Server (e.g., `api.migratorrr.io`)
2. Update Web's `NEXT_PUBLIC_API_URL` to `https://api.migratorrr.io`

## Environment Variables Reference

### Server (Required)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Auto from Railway |
| `REDIS_URL` | Redis connection string | Auto from Railway |
| `MASTER_ENCRYPTION_KEY` | 64-char hex for wallet encryption | `openssl rand -hex 32` |
| `JWT_SECRET` | 64-char hex for auth tokens | `openssl rand -hex 32` |
| `HELIUS_API_KEY` | Helius RPC API key | From dev.helius.xyz |
| `PLATFORM_FEE_WALLET` | Solana wallet for fees | Your wallet address |
| `CORS_ORIGIN` | Frontend URL | Web service URL |

### Server (Optional)

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `LOG_LEVEL` | Logging level | `info` |
| `BACKUP_RPC_URL` | Fallback RPC | None |
| `PLATFORM_FEE_BPS` | Fee in basis points | `100` (1%) |
| `ADMIN_SECRET` | Admin access token | Generated |
| `SNIPE_WORKER_CONCURRENCY` | Parallel snipe jobs | `25` |
| `SNIPE_RATE_LIMIT` | Max snipes/minute | `200` |

### Web (Required)

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | Backend API URL | Server's Railway URL |
| `NEXT_PUBLIC_SOCKET_URL` | WebSocket URL | Same as API URL |
| `NEXT_PUBLIC_RPC_URL` | Solana RPC for client | Public or Helius |

## Post-Deployment Checklist

After deployment, verify:

- [ ] Server health check: `curl https://your-server.up.railway.app/health`
- [ ] Web loads: Visit your web URL
- [ ] Database connected: Check server logs for "PostgreSQL connected"
- [ ] Redis connected: Check server logs for "Redis connected"
- [ ] WebSocket works: Open browser console, look for socket connection
- [ ] Create a test sniper (won't execute without funds, but tests the flow)

## Monitoring & Logs

- **Railway Dashboard**: View logs for each service in real-time
- **Health Endpoint**: `GET /health` returns `{"status":"ok","timestamp":...}`
- **Server Logs**: Migration detection, snipe execution, errors

## Scaling

Railway automatically handles scaling, but for optimal performance:

1. **Upgrade Railway Plan**: Hobby ($5/mo) → Pro for more resources
2. **Increase worker concurrency**: Set `SNIPE_WORKER_CONCURRENCY=50` for higher volume
3. **Helius Plan**: Upgrade to Growth plan for higher RPC limits

## Troubleshooting

### "CORS Error" in browser
- Ensure `CORS_ORIGIN` in Server matches your Web URL exactly (with https://)
- Redeploy server after changing CORS

### "Database connection failed"
- Check `DATABASE_URL` is set correctly
- Ensure PostgreSQL service is running
- Verify service linking in Railway

### "Redis connection failed"
- Check `REDIS_URL` is set correctly
- Ensure Redis service is running
- Verify service linking in Railway

### Snipers not executing
- Check Helius API key is valid
- Verify `PLATFORM_FEE_WALLET` is a valid Solana address
- Check server logs for specific errors

### WebSocket not connecting
- Ensure `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SOCKET_URL` are correct
- Check for mixed content (http vs https)
- Verify CORS is configured correctly

## Security Notes

1. **Never commit secrets**: All sensitive values should only be in Railway's environment variables
2. **Backup MASTER_ENCRYPTION_KEY**: Store it securely - losing it means losing access to encrypted wallets
3. **Rotate secrets**: If compromised, generate new JWT_SECRET and ADMIN_SECRET
4. **Monitor usage**: Check Railway usage and Helius API usage regularly

## Cost Estimate

Railway pricing (as of 2024):
- **Hobby Plan**: $5/month (includes $5 credits)
- **PostgreSQL**: ~$5-10/month depending on usage
- **Redis**: ~$5-10/month depending on usage
- **Server/Web**: Pay per usage (typically $5-20/month each)

**Estimated Total**: $20-50/month for a production setup

---

For support or issues, check the repository's Issues page or contact the team.
