FROM node:18

WORKDIR /app

RUN apt update && apt install -y ffmpeg python3 python3-pip
RUN pip3 install yt-dlp

COPY package.json .
RUN npm install

COPY . .

CMD ["npm", "start"]