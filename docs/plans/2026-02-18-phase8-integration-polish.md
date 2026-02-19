# Phase 8: Integration & Polish — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Containerize the full stack with Docker Compose, fix frontend bugs found in Phase 7 review, add seed data for demo, write E2E tests, and produce a README with architecture diagram.

**Architecture:** Docker Compose orchestrates 5 services (postgres+pgvector, redis, minio, backend, frontend). Frontend bugs (AuthContext crash, unused files, missing 401 handling, mobile sidebar) are fixed first so Docker images build cleanly. Seed data uses Spring Boot's `data.sql` for demo portfolios. E2E tests use JUnit + MockMvc for backend integration flows.

**Tech Stack:** Docker Compose, multi-stage Dockerfiles (Gradle 9.3 + JDK 21 / Node 22 + nginx), Spring Boot 4.0.2, React 19 + Vite 7, PostgreSQL 17 + pgvector, Redis 7, MinIO

---

### Task 1: Frontend Bug Fixes — AuthContext JSON.parse crash

**Files:**
- Modify: `frontend/src/context/AuthContext.tsx:18-21`

**Step 1: Fix the JSON.parse crash**

The `AuthProvider` initializer calls `JSON.parse(stored)` without try-catch. If localStorage contains corrupted data, the entire app crashes on load.

Replace lines 18-21 in `AuthContext.tsx`:

```tsx
const [user, setUser] = useState<AuthUser | null>(() => {
  const stored = localStorage.getItem('auth_user')
  return stored ? JSON.parse(stored) : null
})
```

With:

```tsx
const [user, setUser] = useState<AuthUser | null>(() => {
  const stored = localStorage.getItem('auth_user')
  if (!stored) return null
  try {
    return JSON.parse(stored) as AuthUser
  } catch {
    localStorage.removeItem('auth_user')
    localStorage.removeItem('jwt_token')
    return null
  }
})
```

**Step 2: Verify the app still loads**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors.

**Step 3: Commit**

```bash
git add frontend/src/context/AuthContext.tsx
git commit -m "fix: wrap AuthContext JSON.parse in try-catch to prevent crash on corrupted localStorage"
```

---

### Task 2: Frontend Bug Fixes — Global 401 handling + file cleanup

**Files:**
- Modify: `frontend/src/api/client.ts:24-27`
- Modify: `frontend/index.html:7`
- Delete: `frontend/src/App.css`
- Delete: `frontend/src/assets/react.svg`

**Step 1: Add global 401 redirect in `client.ts`**

In `apiFetch()`, after the `!res.ok` check, add 401 handling that clears auth state and redirects to login. Replace the error block:

```ts
if (!res.ok) {
  const text = await res.text()
  throw new Error(`${res.status}: ${text}`)
}
```

With:

```ts
if (!res.ok) {
  if (res.status === 401) {
    localStorage.removeItem('auth_user')
    localStorage.removeItem('jwt_token')
    window.location.href = '/login'
    throw new Error('Session expired')
  }
  const text = await res.text()
  throw new Error(`${res.status}: ${text}`)
}
```

**Step 2: Fix `index.html` title**

Change line 7 in `frontend/index.html`:

```html
<title>frontend</title>
```

To:

```html
<title>FinSentinel</title>
```

**Step 3: Delete unused Vite template files**

```bash
rm frontend/src/App.css
rm frontend/src/assets/react.svg
```

Verify no imports reference these files:

```bash
grep -r "App.css" frontend/src/
grep -r "react.svg" frontend/src/
```

Expected: No results (they were never imported by our code).

**Step 4: Verify build**

Run: `cd frontend && npm run build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/index.html
git rm frontend/src/App.css frontend/src/assets/react.svg
git commit -m "fix: add global 401 redirect, fix page title, remove unused Vite template files"
```

---

### Task 3: Mobile-Responsive Sidebar

**Files:**
- Modify: `frontend/src/components/Layout.tsx`

**Step 1: Add mobile hamburger menu and responsive sidebar**

The current Layout has a fixed `w-56` sidebar that doesn't collapse on mobile. Add:
- A hamburger button visible only on `md:hidden`
- The sidebar hidden by default on mobile, togglable via state
- A backdrop overlay when sidebar is open on mobile
- Auto-close sidebar on nav link click (mobile)

Replace the entire `Layout.tsx` with:

```tsx
import { useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import {
  LayoutDashboard, MessageSquare, Briefcase, BarChart2,
  FileText, FileDown, LogOut, Menu, X
} from 'lucide-react'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { to: '/analysis', label: 'Analysis', icon: BarChart2 },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/reports', label: 'Reports', icon: FileDown },
]

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const sidebarContent = (
    <>
      <div className="px-4 py-5 border-b border-gray-800">
        <p className="text-lg font-bold text-blue-400">FinSentinel</p>
        <p className="text-xs text-gray-500 truncate">{user?.username}</p>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100'
              }`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>
      <button
        onClick={handleLogout}
        className="flex items-center gap-3 px-5 py-4 text-sm text-gray-500 hover:text-red-400 border-t border-gray-800 transition-colors"
      >
        <LogOut size={16} /> Logout
      </button>
    </>
  )

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Mobile header */}
      <div className="fixed top-0 left-0 right-0 z-30 flex items-center h-14 px-4 bg-gray-900 border-b border-gray-800 md:hidden">
        <button onClick={() => setSidebarOpen(true)} aria-label="Open menu">
          <Menu size={20} />
        </button>
        <p className="ml-3 text-lg font-bold text-blue-400">FinSentinel</p>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — mobile: slide-over; desktop: fixed */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-56 flex flex-col bg-gray-900 border-r border-gray-800
          transform transition-transform duration-200 ease-in-out
          md:relative md:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Mobile close button */}
        <button
          onClick={() => setSidebarOpen(false)}
          className="absolute top-4 right-3 text-gray-500 hover:text-gray-100 md:hidden"
          aria-label="Close menu"
        >
          <X size={18} />
        </button>
        {sidebarContent}
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
            className="h-full"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
```

**Step 2: Verify build**

Run: `cd frontend && npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add frontend/src/components/Layout.tsx
git commit -m "feat: add mobile-responsive sidebar with hamburger menu and slide-over drawer"
```

---

### Task 4: Backend Dockerfile (multi-stage)

**Files:**
- Create: `Dockerfile`

**Step 1: Create the backend Dockerfile**

Create `Dockerfile` in project root. Uses multi-stage build: Gradle 9 + JDK 21 for build, Eclipse Temurin 21 JRE for runtime.

```dockerfile
# --- Build stage ---
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY gradle gradle
COPY gradlew build.gradle settings.gradle ./
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon || true
COPY src src
RUN ./gradlew bootJar --no-daemon -x test

# --- Runtime stage ---
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/build/libs/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

**Step 2: Verify Dockerfile builds**

Run: `docker build -t finsentinel-backend .`
Expected: Image builds successfully (may take a few minutes for Gradle download).

**Step 3: Commit**

```bash
git add Dockerfile
git commit -m "feat: add multi-stage backend Dockerfile (JDK 21 build + JRE runtime)"
```

---

### Task 5: Frontend Dockerfile (multi-stage + nginx)

**Files:**
- Create: `frontend/Dockerfile`
- Create: `frontend/nginx.conf`

**Step 1: Create nginx config for SPA routing**

Create `frontend/nginx.conf`:

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://backend:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_buffering off;
    }
}
```

Note: `proxy_buffering off` is critical for SSE streaming to work through nginx.

**Step 2: Create the frontend Dockerfile**

Create `frontend/Dockerfile`:

```dockerfile
# --- Build stage ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# --- Runtime stage ---
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

**Step 3: Verify Dockerfile builds**

Run: `cd frontend && docker build -t finsentinel-frontend .`
Expected: Image builds successfully.

**Step 4: Commit**

```bash
git add frontend/Dockerfile frontend/nginx.conf
git commit -m "feat: add frontend Dockerfile (Node 22 build + nginx SPA) with API proxy and SSE support"
```

---

### Task 6: Docker Compose — Full-Stack Orchestration

**Files:**
- Create: `docker-compose.yml`
- Create: `.dockerignore`
- Create: `frontend/.dockerignore`

**Step 1: Create root `.dockerignore`**

Create `.dockerignore`:

```
.git
.env
.gradle
build
frontend
node_modules
*.md
docs
work-logs
task_plan.md
notes.md
```

**Step 2: Create `frontend/.dockerignore`**

Create `frontend/.dockerignore`:

```
node_modules
dist
.env
*.md
```

**Step 3: Create `docker-compose.yml`**

Create `docker-compose.yml` in project root:

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_DB: finsentinel
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: 123456
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: rustfsadmin
      MINIO_ROOT_PASSWORD: rustfsadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - miniodata:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 3s
      retries: 5

  backend:
    build: .
    ports:
      - "8080:8080"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      minio:
        condition: service_healthy
    environment:
      POSTGRES_HOST: postgres
      POSTGRES_PORT: 5432
      POSTGRES_DB: finsentinel
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: 123456
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_DB: 0
      APP_STORAGE_ENDPOINT: http://minio:9000
      APP_STORAGE_ACCESS_KEY: rustfsadmin
      APP_STORAGE_SECRET_KEY: rustfsadmin
      APP_STORAGE_BUCKET: finsentinel
      APP_STORAGE_REGION: us-east-1
      HIBERNATE_DDL_AUTO: update
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY}
      AI_MODEL: ${AI_MODEL:-google/gemini-3-flash-preview}
      POLYGON_API_KEY: ${POLYGON_API_KEY}
      FIRECRAWL_API_KEY: ${FIRECRAWL_API_KEY:-}
      JWT_SECRET: ${JWT_SECRET:-H9c3pV2mX7nQ5sL8kR4tY6wZ1aD0fG8hJ3uK9eB2nM5xS7qP4vT6rW1yZ8dC0a}
      JWT_EXPIRATION: ${JWT_EXPIRATION:-86400000}

  frontend:
    build: ./frontend
    ports:
      - "3000:80"
    depends_on:
      - backend

volumes:
  pgdata:
  miniodata:
```

Key design decisions:
- `pgvector/pgvector:pg17` — official pgvector image (includes the extension pre-installed)
- Backend reads API keys from host `.env` via `${OPENROUTER_API_KEY}` substitution
- Frontend nginx proxies `/api/` to `backend:8080` (no CORS needed)
- Frontend on port 3000 (not 5173 — this is the production container)
- Health checks on all infra services; backend `depends_on` with `condition: service_healthy`

**Step 4: Verify compose starts (dry-run)**

Run: `docker compose config`
Expected: Rendered YAML without errors.

**Step 5: Commit**

```bash
git add docker-compose.yml .dockerignore frontend/.dockerignore
git commit -m "feat: add Docker Compose orchestration for full-stack deployment (5 services)"
```

---

### Task 7: Seed Data — Sample User, Portfolio, and Holdings

**Files:**
- Create: `src/main/resources/data.sql`
- Modify: `src/main/resources/application.yaml` (add `spring.sql.init.mode: always` conditionally)

**Step 1: Create seed SQL**

Create `src/main/resources/data.sql`:

```sql
-- Seed data: demo user + sample portfolio + holdings
-- Password is BCrypt hash of "demo123"
-- Only inserts if demo user doesn't exist (idempotent)

INSERT INTO users (id, username, email, password, created_at, updated_at)
SELECT
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'demo',
    'demo@finsentinel.com',
    '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'demo');

INSERT INTO portfolios (id, name, description, user_id, created_at, updated_at)
SELECT
    'b0000000-0000-0000-0000-000000000001'::uuid,
    'Tech Growth Portfolio',
    'High-growth technology stocks focused on AI and cloud computing',
    'a0000000-0000-0000-0000-000000000001'::uuid,
    NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM portfolios WHERE id = 'b0000000-0000-0000-0000-000000000001'::uuid);

INSERT INTO portfolios (id, name, description, user_id, created_at, updated_at)
SELECT
    'b0000000-0000-0000-0000-000000000002'::uuid,
    'Balanced Income Portfolio',
    'Diversified portfolio with dividend-paying stocks and stable growth',
    'a0000000-0000-0000-0000-000000000001'::uuid,
    NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM portfolios WHERE id = 'b0000000-0000-0000-0000-000000000002'::uuid);

-- Holdings for Tech Growth Portfolio
INSERT INTO holdings (id, ticker, name, quantity, average_cost, portfolio_id, created_at, updated_at)
SELECT id, ticker, name, quantity, average_cost, portfolio_id, NOW(), NOW()
FROM (VALUES
    ('c0000000-0000-0000-0000-000000000001'::uuid, 'AAPL', 'Apple Inc.', 50.000000, 185.50, 'b0000000-0000-0000-0000-000000000001'::uuid),
    ('c0000000-0000-0000-0000-000000000002'::uuid, 'NVDA', 'NVIDIA Corporation', 30.000000, 720.00, 'b0000000-0000-0000-0000-000000000001'::uuid),
    ('c0000000-0000-0000-0000-000000000003'::uuid, 'MSFT', 'Microsoft Corporation', 40.000000, 410.25, 'b0000000-0000-0000-0000-000000000001'::uuid),
    ('c0000000-0000-0000-0000-000000000004'::uuid, 'GOOGL', 'Alphabet Inc.', 25.000000, 152.80, 'b0000000-0000-0000-0000-000000000001'::uuid)
) AS t(id, ticker, name, quantity, average_cost, portfolio_id)
WHERE NOT EXISTS (SELECT 1 FROM holdings WHERE id = 'c0000000-0000-0000-0000-000000000001'::uuid);

-- Holdings for Balanced Income Portfolio
INSERT INTO holdings (id, ticker, name, quantity, average_cost, portfolio_id, created_at, updated_at)
SELECT id, ticker, name, quantity, average_cost, portfolio_id, NOW(), NOW()
FROM (VALUES
    ('c0000000-0000-0000-0000-000000000005'::uuid, 'JNJ', 'Johnson & Johnson', 60.000000, 155.30, 'b0000000-0000-0000-0000-000000000002'::uuid),
    ('c0000000-0000-0000-0000-000000000006'::uuid, 'PG', 'Procter & Gamble', 45.000000, 162.75, 'b0000000-0000-0000-0000-000000000002'::uuid),
    ('c0000000-0000-0000-0000-000000000007'::uuid, 'TSLA', 'Tesla Inc.', 20.000000, 245.00, 'b0000000-0000-0000-0000-000000000002'::uuid),
    ('c0000000-0000-0000-0000-000000000008'::uuid, 'AMZN', 'Amazon.com Inc.', 35.000000, 188.90, 'b0000000-0000-0000-0000-000000000002'::uuid)
) AS t(id, ticker, name, quantity, average_cost, portfolio_id)
WHERE NOT EXISTS (SELECT 1 FROM holdings WHERE id = 'c0000000-0000-0000-0000-000000000005'::uuid);
```

**Step 2: Add SQL init mode to application.yaml**

Add under `spring:` section in `application.yaml`, after the `jpa:` block:

```yaml
  sql:
    init:
      mode: always
```

This tells Spring Boot to run `data.sql` on every startup. The `WHERE NOT EXISTS` clauses make it idempotent.

**Step 3: Verify the app still compiles**

Run: `./gradlew compileJava`
Expected: BUILD SUCCESSFUL

**Step 4: Commit**

```bash
git add src/main/resources/data.sql src/main/resources/application.yaml
git commit -m "feat: add seed data (demo user, 2 portfolios, 8 holdings) with idempotent SQL inserts"
```

---

### Task 8: E2E Integration Tests — Auth + Portfolio Flow

**Files:**
- Create: `src/test/java/com/example/finsentinel/integration/AuthFlowIntegrationTest.java`
- Create: `src/test/java/com/example/finsentinel/integration/PortfolioFlowIntegrationTest.java`

**Step 1: Create Auth flow integration test**

Create `src/test/java/com/example/finsentinel/integration/AuthFlowIntegrationTest.java`:

```java
package com.example.finsentinel.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class AuthFlowIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void registerAndLoginFlow() throws Exception {
        String username = "testuser_" + System.currentTimeMillis();
        String registerBody = objectMapper.writeValueAsString(Map.of(
                "username", username,
                "email", username + "@test.com",
                "password", "TestPass123!"
        ));

        // Register
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(jsonPath("$.username").value(username));

        // Login with same credentials
        String loginBody = objectMapper.writeValueAsString(Map.of(
                "username", username,
                "password", "TestPass123!"
        ));

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").isNotEmpty());
    }

    @Test
    void loginWithWrongPassword() throws Exception {
        String loginBody = objectMapper.writeValueAsString(Map.of(
                "username", "nonexistent",
                "password", "wrong"
        ));

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody))
                .andExpect(status().isUnauthorized());
    }
}
```

**Step 2: Create Portfolio flow integration test**

Create `src/test/java/com/example/finsentinel/integration/PortfolioFlowIntegrationTest.java`:

```java
package com.example.finsentinel.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.util.Map;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class PortfolioFlowIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private String jwtToken;

    @BeforeEach
    void setup() throws Exception {
        String username = "portfolio_test_" + System.currentTimeMillis();
        String body = objectMapper.writeValueAsString(Map.of(
                "username", username,
                "email", username + "@test.com",
                "password", "TestPass123!"
        ));

        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andReturn();

        JsonNode json = objectMapper.readTree(result.getResponse().getContentAsString());
        jwtToken = json.get("token").asText();
    }

    @Test
    void createPortfolioAndAddHolding() throws Exception {
        // Create portfolio
        String portfolioBody = objectMapper.writeValueAsString(Map.of(
                "name", "Test Portfolio",
                "description", "Integration test portfolio"
        ));

        MvcResult createResult = mockMvc.perform(post("/api/portfolios")
                        .header("Authorization", "Bearer " + jwtToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(portfolioBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Test Portfolio"))
                .andReturn();

        String portfolioId = objectMapper.readTree(
                createResult.getResponse().getContentAsString()
        ).get("id").asText();

        // Add holding
        String holdingBody = objectMapper.writeValueAsString(Map.of(
                "ticker", "AAPL",
                "name", "Apple Inc.",
                "quantity", 10,
                "averageCost", 185.50
        ));

        mockMvc.perform(post("/api/portfolios/" + portfolioId + "/holdings")
                        .header("Authorization", "Bearer " + jwtToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(holdingBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ticker").value("AAPL"));

        // List holdings
        mockMvc.perform(get("/api/portfolios/" + portfolioId)
                        .header("Authorization", "Bearer " + jwtToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.holdings").isArray())
                .andExpect(jsonPath("$.holdings[0].ticker").value("AAPL"));
    }

    @Test
    void unauthenticatedAccessDenied() throws Exception {
        mockMvc.perform(get("/api/portfolios"))
                .andExpect(status().isUnauthorized());
    }
}
```

**Step 3: Run the tests**

Run: `./gradlew test --tests "com.example.finsentinel.integration.*"`
Expected: All tests pass.

> **Note:** These tests require a running PostgreSQL and Redis. If CI doesn't have them, the tests will be skipped or fail. For now, they run against the local dev environment. Testcontainers can be added in a future phase if needed.

**Step 4: Commit**

```bash
git add src/test/java/com/example/finsentinel/integration/
git commit -m "test: add E2E integration tests for auth and portfolio flows"
```

---

### Task 9: README + Architecture Diagram

**Files:**
- Modify: `README.md` (replace placeholder content)

**Step 1: Write the README**

Replace the entire `README.md` with comprehensive project documentation:

```markdown
# FinSentinel

AI-Powered Investment Risk Assessment & Compliance Agent

## Overview

FinSentinel is a full-stack intelligent investment risk assessment tool built with **Spring AI Agent architecture**. Unlike simple chatbots, the LLM orchestrates tool calls for real-time market data, technical analysis, RAG-based document retrieval, and compliance checks, then synthesizes structured risk reports.

## Architecture

```
                    React 19 + Vite 7 + Tailwind CSS 4
                    ┌─────────────────────────────────┐
                    │   Dashboard │ Chat │ Portfolio   │
                    │   Analysis │ Documents │ Reports │
                    └──────────────┬──────────────────┘
                                   │ SSE / REST
                    ┌──────────────┴──────────────────┐
                    │     Spring Boot 4.0 + Spring AI  │
                    │                                   │
                    │  ┌─ JWT Auth ─── Rate Limiter ─┐ │
                    │  │                              │ │
                    │  │  AI Agent Orchestrator        │ │
                    │  │  ┌──────────────────────┐    │ │
                    │  │  │ StockMarketTool       │    │ │
                    │  │  │ TechnicalIndicatorTool│    │ │
                    │  │  │ PortfolioAnalysisTool │    │ │
                    │  │  │ NewsAnalysisTool      │    │ │
                    │  │  │ ComplianceCheckTool   │    │ │
                    │  │  └──────────────────────┘    │ │
                    │  │                              │ │
                    │  │  RAG Advisor (pgvector)       │ │
                    │  │  Compliance Guardrails        │ │
                    │  │  BeanOutputConverter→RiskReport│ │
                    │  └──────────────────────────────┘ │
                    └──┬──────┬──────┬──────┬──────────┘
                       │      │      │      │
               ┌───────┴┐ ┌──┴───┐ ┌┴─────┐ ┌┴─────────┐
               │Postgres│ │Redis │ │MinIO │ │Polygon.io│
               │pgvector│ │Cache │ │S3    │ │Market API│
               └────────┘ └──────┘ └──────┘ └──────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4, Framer Motion, Recharts |
| Backend | Spring Boot 4.0.2, Spring AI 2.0, Java 21 |
| AI Model | Google Gemini 3 Flash (via OpenRouter) |
| Database | PostgreSQL 17 + pgvector (HNSW, cosine, 1536d) |
| Cache | Redis 7 (market data TTL + rate limiting) |
| Storage | MinIO (S3-compatible, document uploads) |
| PDF Export | iText 8 |
| Security | JWT + Spring Security + @RateLimit AOP |

## Quick Start

### Prerequisites

- Docker & Docker Compose
- API keys: [OpenRouter](https://openrouter.ai), [Polygon.io](https://polygon.io)

### 1. Clone & Configure

   ```bash
   git clone https://github.com/your-org/finsentinel.git
   cd finsentinel
   cp .env.example .env
   # Edit .env with your API keys
   ```

### 2. Start All Services

   ```bash
   docker compose up -d
   ```

   This starts: PostgreSQL + pgvector, Redis, MinIO, Backend (port 8080), Frontend (port 3000).

### 3. Access the App

   - **Frontend:** http://localhost:3000
   - **API:** http://localhost:8080/api
   - **MinIO Console:** http://localhost:9001 (rustfsadmin / rustfsadmin)

### Demo Account

   - Username: `demo`
   - Password: `demo123`

## Development

### Backend

```bash
./gradlew bootRun          # Run with hot reload
./gradlew test             # Run all tests
./gradlew test --tests "com.example.finsentinel.integration.*"  # Integration tests
```

### Frontend

```bash
cd frontend
npm install
npm run dev                # Vite dev server (port 5173, proxies /api to 8080)
npm run build              # Production build
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Register new user |
| POST | `/api/auth/login` | Login, returns JWT |
| POST | `/api/chat/stream` | SSE streaming AI chat |
| POST | `/api/chat/assess` | Synchronous risk assessment |
| GET | `/api/chat/sessions/{id}/messages` | Chat session history |
| GET/POST/DELETE | `/api/portfolios` | Portfolio CRUD |
| POST/DELETE | `/api/portfolios/{id}/holdings` | Holdings management |
| GET | `/api/portfolios/{id}/reports` | List risk reports |
| GET | `/api/market/quote/{ticker}` | Real-time stock quote |
| GET | `/api/market/history` | Historical price data |
| POST | `/api/documents/upload` | Upload document for RAG |
| GET | `/api/documents` | List documents |
| GET | `/api/reports/{id}/pdf` | Download PDF risk report |

## Project Structure

```
finsentinel/
├── src/main/java/com/example/finsentinel/
│   ├── config/          # @Configuration + @ConfigurationProperties
│   ├── security/        # JWT filter chain
│   ├── model/           # JPA entities
│   ├── dto/             # Java records (auth, chat, portfolio, risk)
│   ├── repository/      # Spring Data JPA
│   ├── service/         # Business logic
│   ├── agent/tool/      # Spring AI function calling tools
│   ├── agent/advisor/   # RAG + compliance advisors
│   ├── agent/output/    # BeanOutputConverter (RiskReport)
│   ├── controller/      # REST + SSE endpoints
│   ├── mapper/          # MapStruct interfaces
│   └── ratelimit/       # @RateLimit + Redis+Lua
├── frontend/
│   ├── src/
│   │   ├── api/         # API client modules
│   │   ├── components/  # Layout, ProtectedRoute
│   │   ├── context/     # AuthContext
│   │   └── pages/       # 8 page components
│   └── nginx.conf       # Production reverse proxy
├── docker-compose.yml
├── Dockerfile           # Backend multi-stage
└── docs/plans/          # Implementation plans
```

## License

MIT
```

**Step 2: Create .env.example**

Create `.env.example` (template without real secrets):

```bash
# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=finsentinel
POSTGRES_USER=postgres
POSTGRES_PASSWORD=changeme

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=0

# MinIO (S3-compatible storage)
APP_STORAGE_ENDPOINT=http://localhost:9000
APP_STORAGE_ACCESS_KEY=rustfsadmin
APP_STORAGE_SECRET_KEY=rustfsadmin
APP_STORAGE_BUCKET=finsentinel
APP_STORAGE_REGION=us-east-1

# Hibernate
HIBERNATE_DDL_AUTO=update

# AI - OpenRouter (REQUIRED)
OPENROUTER_API_KEY=sk-or-v1-your-key-here
AI_MODEL=google/gemini-3-flash-preview

# Market Data - Polygon.io (REQUIRED)
POLYGON_API_KEY=your-polygon-key-here

# Firecrawl (optional)
FIRECRAWL_API_KEY=

# JWT
JWT_SECRET=change-this-to-a-random-64-char-string
JWT_EXPIRATION=86400000
```

**Step 3: Commit**

```bash
git add README.md .env.example
git commit -m "docs: add comprehensive README with architecture diagram, quick start, and API reference"
```

---

### Task 10: Update task_plan.md — Mark Phase 8 Complete

**Files:**
- Modify: `task_plan.md`

**Step 1: Update Phase 8 status in `task_plan.md`**

Mark all Phase 8 tasks as complete with status notes:

```markdown
## Phase 8: Integration & Polish ✅ COMPLETE

| Task | Owner | Status |
|------|-------|--------|
| 8.0 Frontend bug fixes (AuthContext, 401 handling, file cleanup) | 🤖 | ✅ |
| 8.1 Mobile-responsive sidebar | 🤖 | ✅ |
| 8.2 Docker Compose (full-stack containerization) | 🤖 | ✅ 5 services: postgres+pgvector, redis, minio, backend, frontend |
| 8.3 Seed data (demo user + 2 portfolios + 8 holdings) | 🤖 | ✅ Idempotent data.sql |
| 8.4 E2E integration tests | 🤖 | ✅ Auth + Portfolio flow MockMvc tests |
| 8.5 README + architecture diagram | 🤖 | ✅ + .env.example template |
```

Update the Status section at the bottom:

```
**Phase 8 COMPLETE (2026-02-18)** — Docker Compose (5 services with health checks), frontend bug fixes (AuthContext crash, 401 handling, file cleanup), mobile sidebar, seed data (demo user + 2 portfolios), E2E integration tests, README with architecture diagram.
```

**Step 2: Commit**

```bash
git add task_plan.md
git commit -m "docs: mark Phase 8 complete in task plan"
```

---

## Execution Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | AuthContext JSON.parse crash fix | `AuthContext.tsx` |
| 2 | Global 401 handling + file cleanup + title fix | `client.ts`, `index.html`, delete `App.css` + `react.svg` |
| 3 | Mobile-responsive sidebar | `Layout.tsx` |
| 4 | Backend Dockerfile (multi-stage) | `Dockerfile` |
| 5 | Frontend Dockerfile + nginx | `frontend/Dockerfile`, `frontend/nginx.conf` |
| 6 | Docker Compose orchestration | `docker-compose.yml`, `.dockerignore`, `frontend/.dockerignore` |
| 7 | Seed data | `data.sql`, `application.yaml` |
| 8 | E2E integration tests | 2 test classes |
| 9 | README + .env.example | `README.md`, `.env.example` |
| 10 | Update task plan | `task_plan.md` |

Total: 10 tasks, ~15 files created/modified
