FROM node:20-slim

RUN apt update && apt install -y \
  ffmpeg \
  curl \
  python3 \
  python-is-python3

WORKDIR /app

COPY package.json .
RUN npm install

COPY . .

CMD ["npm", "start"]
