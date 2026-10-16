FROM node:22.14.0-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --ignore-scripts --no-audit --no-fund --offline
COPY . .

ENV NODE_ENV=production
EXPOSE 4173
CMD ["node", "server.mjs"]
