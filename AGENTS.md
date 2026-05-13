# AGENTS.md

## Cursor Cloud specific instructions

### Overview

UdaPeople is a full-stack HR/employee management app: React 16 frontend + NestJS 6 backend + PostgreSQL. The project targets **Node.js 13.8.0** (via `nvm`).

### Services

| Service | Port | How to start |
|---|---|---|
| PostgreSQL | 5532 | `docker compose -f util/docker-compose.yml up -d` |
| Backend (NestJS) | 3030 | `cd backend && npm run start:dev` |
| Frontend (React) | 3000 | `cd frontend && API_URL=http://localhost:3030 npm start` |

### Important caveats

- **Node version**: Must use Node.js 13.8.0. Run `source "$HOME/.nvm/nvm.sh" && nvm use 13.8.0` before any npm commands.
- **Docker**: Docker daemon must be started before PostgreSQL (`sudo dockerd &`). Socket permissions may need fixing (`sudo chmod 666 /var/run/docker.sock`).
- **Backend .env**: Copy `backend/.env.sample` to `backend/.env` before running the backend or migrations. The sample file has correct defaults for the Docker Compose PostgreSQL instance.
- **Migrations**: Run `cd backend && npm run migrations` after starting PostgreSQL and before starting the backend for the first time.
- **Frontend API_URL**: The frontend requires `API_URL=http://localhost:3030` either as an environment variable or in `frontend/.env`. Without it, `process.env.API_URL` is undefined and API calls fail.
- **Frontend rendering bug**: The frontend has a pre-existing bug where `JSON.parse(tags)` is called on an already-parsed object in multiple components (Employees list, EditEmployee, ViewEmployee, EmployeeSearch). This causes `SyntaxError: '[object Object]' is not valid JSON` and a blank page when employees exist with object-type tags. This is a code issue, not an environment issue.
- **Lint**: Both `backend/` and `frontend/` use `tslint`. Both have pre-existing lint errors (migration line length in backend, style issues in frontend). Run with `npm run lint`.
- **Tests**: Backend: `cd backend && npm test` (79 tests). Frontend: `cd frontend && npm test` (12 tests). All pass.
