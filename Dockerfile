# Build multi-étapes — image finale légère (Next.js standalone).
FROM node:24-alpine AS base

# --- Dépendances ---------------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts

# --- Build -----------------------------------------------------------------------
# Cet étage sert aussi de conteneur d'outillage (`tools` dans docker-compose) :
# il contient l'arbre npm complet (CLI Prisma, tsx, scripts/).
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# --- Image finale ------------------------------------------------------------------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

RUN mkdir -p /app/data/uploads /app/data/documents && chown -R nextjs:nodejs /app/data
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

# Les migrations sont appliquées avant le démarrage par le service `tools`
# (voir docker-compose.yml et ops/deploy.ts).
CMD ["node", "server.js"]
