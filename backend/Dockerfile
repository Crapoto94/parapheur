# Backend autonome du Parapheur électronique.
# Reprend le module modules/parapheur du monolithe AppDSI avec la couche shared
# (base PostgreSQL ivry_admin, stockage SMB/Alfresco, réglages SQLite, mails).
FROM node:lts-alpine AS base
WORKDIR /app

# Outils de build pour les modules natifs (sqlite3), tzdata pour TZ=Europe/Paris.
RUN apk add --no-cache make gcc g++ python3 py3-setuptools tzdata

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/logs /app/data /app/magapp_img && \
    chmod 755 /app/logs /app/data /app/magapp_img

EXPOSE 3001

# --openssl-legacy-provider : requis par la lib smb2 (NTLM MD4/RC4) sous Node >= 18.
ENV NODE_OPTIONS="--openssl-legacy-provider"
ENV TZ=Europe/Paris

CMD [ "node", "server.js" ]
