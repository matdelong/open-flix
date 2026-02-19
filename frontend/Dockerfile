# Use debian-slim instead of alpine for better 32-bit ARM compatibility
FROM node:20-slim

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

# Force install the specific missing native binding for 32-bit ARM
RUN npm install
RUN npm install @rolldown/binding-linux-arm-gnueabihf

COPY . .

RUN npm run build

# Final stage (Nginx) stays the same
FROM nginx:stable-alpine
COPY --from=0 /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]