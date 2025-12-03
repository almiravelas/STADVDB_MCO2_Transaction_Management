# Docker & Cloud Deployment Guide

## 🚀 Deployment Options

You have multiple options to deploy your application online:

---

## Option 1: Railway.app (Easiest - Free Tier Available)

### Steps:
1. **Go to [Railway.app](https://railway.app/)**
2. **Sign up** with your GitHub account
3. Click **"New Project"** → **"Deploy from GitHub repo"**
4. Select your repository: `almiravelas/STADVDB_MCO2_Transaction_Management`
5. **Add Environment Variables:**
   - Click on your service → **Variables** tab
   - Add all variables from your `.env` file:
     ```
     NODE0_HOST=ccscloud.dlsu.edu.ph
     NODE0_PORT=60226
     NODE0_USER=your_user
     NODE0_PASSWORD=your_password
     NODE0_DB=your_database
     
     NODE1_HOST=ccscloud.dlsu.edu.ph
     NODE1_PORT=60227
     NODE1_USER=your_user
     NODE1_PASSWORD=your_password
     NODE1_DB=your_database
     
     NODE2_HOST=ccscloud.dlsu.edu.ph
     NODE2_PORT=60228
     NODE2_USER=your_user
     NODE2_PASSWORD=your_password
     NODE2_DB=your_database
     
     DB_CONNECTION_LIMIT=10
     DB_QUEUE_LIMIT=0
     ```
6. Railway will automatically deploy
7. **Your app URL will be**: `https://your-app-name.up.railway.app`

**Cost**: Free tier includes $5 credit/month (~500 hours)

---

## Option 2: Render.com (Free - Best for Demo)

### Steps:
1. **Go to [Render.com](https://render.com/)**
2. **Sign up** with GitHub
3. Click **"New +"** → **"Web Service"**
4. Connect your GitHub repo
5. Configure:
   - **Name**: `stadvdb-mco2-app`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
6. **Add Environment Variables** (same as above)
7. Click **"Create Web Service"**
8. **Your app URL will be**: `https://stadvdb-mco2-app.onrender.com`

**Cost**: Free (app sleeps after 15 min of inactivity)

---

## Option 3: Docker + DigitalOcean/AWS/Azure

### Prerequisites:
- Docker installed on your machine
- DigitalOcean/AWS account

### Build Docker Image:
```bash
# Navigate to project directory
cd C:\Users\sigbi\projects\STADVDB_MCO2_Transaction_Management\STADVDB_MCO2_Transaction_Management

# Build the image
docker build -t stadvdb-mco2-app .

# Test locally first
docker run -p 3000:3000 --env-file .env stadvdb-mco2-app

# Visit http://localhost:3000
```

### Deploy to DigitalOcean:
1. **Push to Docker Hub:**
   ```bash
   docker tag stadvdb-mco2-app your-dockerhub-username/stadvdb-mco2-app
   docker push your-dockerhub-username/stadvdb-mco2-app
   ```

2. **Create DigitalOcean Droplet:**
   - Go to [DigitalOcean](https://www.digitalocean.com/)
   - Create Droplet → Docker image
   - SSH into droplet
   - Run:
     ```bash
     docker pull your-dockerhub-username/stadvdb-mco2-app
     docker run -d -p 80:3000 \
       -e NODE0_HOST=ccscloud.dlsu.edu.ph \
       -e NODE0_PORT=60226 \
       # ... add all env vars
       your-dockerhub-username/stadvdb-mco2-app
     ```

**Cost**: $6/month for basic droplet

---

## Option 4: Heroku

### Steps:
1. **Install Heroku CLI**:
   ```bash
   npm install -g heroku
   ```

2. **Login and Create App**:
   ```bash
   cd C:\Users\sigbi\projects\STADVDB_MCO2_Transaction_Management\STADVDB_MCO2_Transaction_Management
   heroku login
   heroku create stadvdb-mco2-app
   ```

3. **Set Environment Variables**:
   ```bash
   heroku config:set NODE0_HOST=ccscloud.dlsu.edu.ph
   heroku config:set NODE0_PORT=60226
   heroku config:set NODE0_USER=your_user
   # ... set all other variables
   ```

4. **Deploy**:
   ```bash
   git push heroku final:main
   ```

5. **Your app URL**: `https://stadvdb-mco2-app.herokuapp.com`

**Cost**: Free tier discontinued, starts at $7/month

---

## Option 5: Docker Compose (Local/Server)

### Run with Docker Compose:
```bash
# Make sure your .env file is properly configured
docker-compose up -d

# Check logs
docker-compose logs -f

# Stop
docker-compose down
```

---

## 📋 Recommended: Railway.app (Fastest Setup)

### Quick Railway Deployment:
1. Push your code to GitHub (if not already)
2. Visit https://railway.app/new
3. Click "Deploy from GitHub repo"
4. Select your repo
5. Add environment variables from your `.env` file
6. Done! You'll get a public URL in ~2 minutes

---

## 🔒 Important: Environment Variables

Make sure to add these variables in your deployment platform:

```env
NODE0_HOST=ccscloud.dlsu.edu.ph
NODE0_PORT=60226
NODE0_USER=<your_database_user>
NODE0_PASSWORD=<your_database_password>
NODE0_DB=<your_database_name>

NODE1_HOST=ccscloud.dlsu.edu.ph
NODE1_PORT=60227
NODE1_USER=<your_database_user>
NODE1_PASSWORD=<your_database_password>
NODE1_DB=<your_database_name>

NODE2_HOST=ccscloud.dlsu.edu.ph
NODE2_PORT=60228
NODE2_USER=<your_database_user>
NODE2_PASSWORD=<your_database_password>
NODE2_DB=<your_database_name>

DB_CONNECTION_LIMIT=10
DB_QUEUE_LIMIT=0
```

---

## ✅ After Deployment

Once deployed, you can:
1. Access your app from anywhere using the public URL
2. Open the URL in multiple devices/browsers to test concurrency
3. Share the URL with team members for testing

**Example URLs:**
- Railway: `https://stadvdb-mco2-app-production.up.railway.app`
- Render: `https://stadvdb-mco2-app.onrender.com`

---

## 🧪 Testing Concurrency After Deployment

1. **Window A**: Open `https://your-deployed-url.com` on your laptop
2. **Window B**: Open `https://your-deployed-url.com` on your phone
3. Perform concurrent edits on User 101
4. Observe blocking behavior in real-time!

---

## Need Help?

Choose **Railway.app** for the easiest deployment - it's free and takes 5 minutes! 🚀
