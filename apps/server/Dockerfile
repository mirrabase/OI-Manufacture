FROM node:22-slim
WORKDIR /app
COPY apps/server/package.json ./package.json
RUN npm pkg delete devDependencies && npm install --omit=dev
COPY apps/server/src ./src
ENV NODE_ENV=production
CMD ["node", "src/index.ts"]
