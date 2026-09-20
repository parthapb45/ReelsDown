# Use official Node.js lightweight image
FROM node:20-bullseye-slim

# Install Python, pip, ffmpeg, and curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp globally
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application files
COPY . .

# Ensure downloads directory exists
RUN mkdir -p downloads

# Expose port (Render/Railway/Fly automatically map this)
ENV PORT=3000
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
