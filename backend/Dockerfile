FROM node:24-slim

WORKDIR /app

# Install build dependencies for compiling native leveldb / classic-level bindings
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    procps \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./

RUN npm install

COPY . .

RUN npm run build

EXPOSE 8000

# Run in watch mode for development auto-reloads
CMD ["npm", "run", "start:dev"]
