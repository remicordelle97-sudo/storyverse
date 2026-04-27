FROM node:20-slim AS builder

WORKDIR /app

# Build args for Vite (needed at build time)
ARG VITE_GOOGLE_CLIENT_ID

# Install OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Production image
FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/
# --ignore-scripts skips the postinstall hook, which expects the `prisma`
# CLI from devDependencies. We invoke `npx prisma generate` explicitly so
# the runtime client is generated against the correct production deps.
RUN npm ci --omit=dev --ignore-scripts && npx prisma generate

# Copy built output
COPY --from=builder /app/dist ./dist

# Copy static assets (login background, etc)
COPY public ./public

# Create images directory
RUN mkdir -p public/images

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

# Run migrations then start the server
CMD npx prisma db push --skip-generate --accept-data-loss && node dist/src/server/index.js
