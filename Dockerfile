FROM node:alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

RUN addgroup -S app && adduser -S -G app app

COPY --chown=app:app . .

USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http=require('http'); const req=http.get({host:'127.0.0.1',port:3000,path:'/'},(res)=>process.exit(res.statusCode===200?0:1)); req.on('error',()=>process.exit(1));" || exit 1

CMD ["node", "server.js"]
