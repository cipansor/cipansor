# Main container of the Azure App Service sidecar set — see nginx.conf.
FROM nginx:1.31-alpine
COPY nginx.conf /etc/nginx/nginx.conf
# Fail the build, not the deploy, on a config error.
RUN nginx -t
EXPOSE 80
