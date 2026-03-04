# Feed Factory Pro

A comprehensive enterprise-grade feed manufacturing management system built with a modern monorepo architecture.

## 🏗️ Project Structure

```
feed-factory-pro/
├── frontend/              # React + Vite + TypeScript frontend
│   ├── src/               # Application source code
│   ├── public/            # Static assets
│   ├── themes/            # UI theme configurations
│   ├── index.html         # HTML entry point
│   ├── vite.config.ts     # Vite build configuration
│   └── tsconfig.json      # TypeScript configuration
│
├── backend/               # NestJS + Prisma backend
│   ├── src/               # NestJS application source
│   ├── prisma/            # Database schema & migrations
│   └── package.json       # Backend dependencies
│
├── scripts/               # Shared utility scripts
│
├── _PROJECT_DOCS/         # Project documentation & reports
├── _ARCHIVE_ISOLATED/     # Archived files (gitignored)
│
├── package.json           # Root workspace configuration
├── docker-compose.prod.yml # Production Docker orchestration
├── nginx.prod.conf        # Production Nginx configuration
├── run-system.sh          # Unix startup script
└── run-system.ps1         # Windows startup script
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Docker (optional, for containerized deployment)

### Development

```bash
# Install dependencies
npm install

# Run full stack (frontend + backend)
npm run dev:full

# Or run individually
npm run start:frontend    # Frontend only
npm run start:backend     # Backend only
```

### Production Build

```bash
# Build for production
npm run build:prod

# Start production server
npm run start:prod
```

## 📦 Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev:full` | Run both frontend and backend concurrently |
| `npm run start:frontend` | Start frontend development server |
| `npm run start:backend` | Start backend development server |
| `npm run build:prod` | Build for production |
| `npm run start:prod` | Start production server |
| `npm run db:sync` | Sync Prisma database schema |
| `npm run test` | Run test suite |
| `npm run health-check` | Run system health checks |

## 🛠️ Tech Stack

### Frontend
- React 18
- Vite
- TypeScript
- Tailwind CSS / Material Design
- i18next (Internationalization)
- Zustand (State Management)
- React Router
- Framer Motion

### Backend
- NestJS
- Prisma ORM
- Socket.IO (Real-time)
- JWT Authentication
- Class Validator

### Database
- SQLite (Development)
- PostgreSQL (Production ready)

## 📄 Documentation

Detailed project documentation, phase reports, and technical specifications are available in the `_PROJECT_DOCS/` directory.

## 🔒 Security Notes

- Never commit `.env` files
- Keep database backups in `_ARCHIVE_ISOLATED/` (gitignored)
- Review `_PROJECT_DOCS/` for security audit reports

## 📝 License

Enterprise License - Feed Factory Pro
