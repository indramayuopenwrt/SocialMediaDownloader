FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
  python3 \
  ffmpeg \
  curl \
  && rm -rf /var/lib/apt/lists/*

RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp

COPY package.json ./
RUN npm install --omit=dev

COPY . .

CMD ["npm", "start"]
