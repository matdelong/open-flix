FROM node:20-slim AS build

WORKDIR /app

# This argument is automatically filled by Docker
ARG TARGETPLATFORM

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

# THE FIX: Only install the 32-bit binding if the target is ARM v7 (the Pi)
RUN if [ "$TARGETPLATFORM" = "linux/arm/v7" ]; then \
    npm install @rolldown/binding-linux-arm-gnueabihf; \
    fi

COPY . .
RUN npm run build

# Final Stage
FROM nginx:stable-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]