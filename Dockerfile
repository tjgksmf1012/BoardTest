# 포인트라운지 실행용 이미지
FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Asia/Seoul

# 의존성 먼저 설치 (레이어 캐시 활용)
COPY package*.json ./
RUN npm ci --omit=dev

# 앱 소스 복사
COPY . .

# 데이터/업로드 디렉터리 (영속화하려면 볼륨으로 마운트)
RUN mkdir -p data uploads
VOLUME ["/app/data", "/app/uploads"]

EXPOSE 3000

# 운영에서는 SESSION_SECRET 를 반드시 주입하세요:
#   docker run -e SESSION_SECRET=... -p 3000:3000 pointlounge
CMD ["node", "server.js"]
