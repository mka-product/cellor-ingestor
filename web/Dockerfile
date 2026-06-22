FROM node:20-alpine AS build

WORKDIR /app
COPY web/package*.json /app/
RUN npm ci --legacy-peer-deps
COPY web /app
RUN npm run build

FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
