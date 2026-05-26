#  Use Node.js 24 as the base image
FROM node:24

# Set the working directory in the container to /app
WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm

# Copy the package.json and pnpm-lock.yaml files to the working directory
COPY package*.json pnpm-lock.yaml ./

# Install the dependencies using pnpm
RUN pnpm install

# Copy the rest of the application code to the working directory
COPY . .

# Expose port 3000 for the application
EXPOSE 3000

# Build the application using pnpm and then start it
RUN pnpm build
CMD ["node", "dist/server.js"]