FROM node:24-slim

WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package*.json ./
RUN npm ci

COPY --chown=node:node . .

EXPOSE 8000

CMD ["npm", "run", "start:dev"]
