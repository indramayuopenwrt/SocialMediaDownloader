FROM node:20-slim

RUN apt update && apt install -y ffmpeg curl python3
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/bin/yt-dlp
RUN chmod +x /usr/bin/yt-dlp

WORKDIR /app
COPY package.json .
RUN npm install

COPY . .

CMD ["npm", "start"]
