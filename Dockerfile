# Qloo harness needs Node >= 22.19; the platform standard is 24.
FROM node:24-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY data/cultures.json data/culture-tags.json ./data/
RUN mkdir -p /app/data/cache && chown -R node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "src/server.mjs"]
