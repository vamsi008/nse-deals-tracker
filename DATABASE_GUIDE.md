# NSE Deals Tracker - Database Setup Guide

This document outlines how to start and manage the MySQL database backing the NSE Deals Tracker application.

## Prerequisites
- **Docker** and **Docker Compose** must be installed on your machine.
- Ports `3306` (MySQL) must be available.

## Starting the Database

The database is fully containerized. To spin it up, simply run:
```bash
docker-compose up -d
```
This will start the `nse-mysql` container in the background.

## Database Initialization
The `docker-compose.yml` file maps the local `db/` directory as a Docker volume. 
- **Data Persistence**: All SQL data is saved safely in the `db/` folder on your machine.
- **Git Ignore**: The `db/` folder and `.env` file have been explicitly added to `.gitignore` to prevent database data or passwords from being pushed to GitHub.

## Connection Credentials
The backend reads from a local `.env` file to connect to the database. Ensure your `.env` contains:
```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=nse_user
DB_PASSWORD=nse_pass
DB_NAME=nse_deals
```

## Stopping the Database
To stop the database from running in the background, run:
```bash
docker-compose down
```

## Useful Commands
- **Check Logs**: `docker logs nse-mysql`
- **Access MySQL Shell**: `docker exec -it nse-mysql mysql -u nse_user -p`
