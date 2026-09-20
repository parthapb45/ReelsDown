FROM node:20-slim

# Install python3, ffmpeg, curl, and ca-certificates from current Debian repositories
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install latest standalone yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application files
COPY . .

# Ensure downloads directory exists
RUN mkdir -p downloads

# Port setup
ENV PORT=3000
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
