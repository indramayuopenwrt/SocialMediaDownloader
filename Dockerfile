FROM node:18-bullseye

WORKDIR /app

# Install ffmpeg + curl
RUN apt update && apt install -y ffmpeg curl

# Install yt-dlp binary (AMAN)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp

# Install Node deps
COPY package.json .
RUN npm install

COPY . .

CMD ["npm", "start"]
