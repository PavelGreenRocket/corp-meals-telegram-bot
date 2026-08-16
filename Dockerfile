FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p generated/documents generated/signed

ENV NODE_ENV=production

CMD ["npm", "start"]
