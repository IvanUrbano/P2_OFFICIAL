# TB System - Setup & Installation Guide

Welcome to the TB System project. This project is configured using **npm Workspaces**, allowing you to manage and run both the frontend and backend easily.

---

## Prerequisites

Before starting, make sure you have the following installed:
1. **Node.js** (v18 or higher recommended)
2. **npm** (comes packaged with Node.js)
3. **PostgreSQL** (v14 or higher recommended)

---

## 🛠️ Quick Start (Recommended)

### 1. Clone the Repository
Clone/fork the repository and navigate into the root directory:
```bash
git clone <your-repository-url>
cd P2_OFFICIAL
```

### 2. Install All Dependencies (Automatically)
Run the following command in the **root** folder. This will automatically install dependencies for both the `BACKEND` and `FRONTEND` folders:
```bash
npm install
```

### 3. Create Backend Environment File (`.env`)
1. In the `BACKEND` directory, copy the template environment file:
   ```bash
   cp BACKEND/.env.example BACKEND/.env
   ```
2. Open `BACKEND/.env` and replace the database credentials with your local PostgreSQL details:
   ```env
   DB_USER=your_postgres_username
   DB_HOST=localhost
   DB_NAME=tb_system
   DB_PASSWORD=your_postgres_password
   DB_PORT=5432
   ```

### 4. Database Setup
1. Ensure PostgreSQL is running.
2. Log into PostgreSQL and create the database:
   ```sql
   CREATE DATABASE tb_system;
   ```
3. *(Optional)* To restore the database backup dump, run:
   ```bash
   psql -U your_postgres_username -d tb_system -f tb_system_backup.dump
   ```
   *Note: If you skip this, the server will automatically run `BACKEND/init.sql` on startup to initialize the database tables.*

### 5. Start Both Servers with One Command
From the **root** directory, run:
```bash
npm run dev
```
This will start both the React frontend and the Express backend concurrently. You can access the application at `http://localhost:5173`.


