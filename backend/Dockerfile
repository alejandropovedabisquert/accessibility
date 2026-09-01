# Imagen oficial de Playwright:
# trae Node, navegadores y dependencias de sistema de Playwright.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /app

# Herramientas necesarias para compilar módulos nativos,
# especialmente better-sqlite3.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# pnpm
RUN corepack enable \
    && corepack prepare pnpm@11.24.0 --activate

# Dependencias
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN pnpm install --frozen-lockfile --prod=false

# Código necesario para compilar
COPY tsconfig.json ./
COPY src ./src

RUN pnpm build

# Eliminar devDependencies después del build
RUN pnpm install --frozen-lockfile --prod

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    RESULTS_DIR=/app/scan-results

RUN mkdir -p /app/data /app/scan-results

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]