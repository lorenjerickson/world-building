FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV PAYLOAD_SECRET=payload-cms-build-only-secret
ENV CMS_DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused
ENV S3_ACCESS_KEY_ID=build-only-access-key
ENV S3_SECRET_ACCESS_KEY=build-only-secret-key
ENV S3_BUCKET=build-only-bucket
ENV S3_ENDPOINT=http://127.0.0.1:9000
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app ./
EXPOSE 3000
CMD ["sh", "-c", "npm run migrate && npm run start:container"]
