FROM node:20-alpine AS build_image

WORKDIR /app

ARG TARGETPLATFORM
ENV TARGETPLATFORM=${TARGETPLATFORM:-linux/amd64}

RUN apk add --no-cache \
    python3 make g++ gcc libc6-compat bash \
    build-base cairo-dev pango-dev jpeg-dev giflib-dev pixman-dev

RUN yarn global add node-gyp

COPY package.json yarn.lock ./
RUN CYPRESS_INSTALL_BINARY=0 yarn install --frozen-lockfile --network-timeout 1000000

COPY . ./

ARG COMMIT_TAG
ENV COMMIT_TAG=${COMMIT_TAG}

RUN yarn build

# remove development dependencies
RUN yarn install --production --ignore-scripts --prefer-offline

RUN rm -rf src server .next/cache

RUN mkdir -p config && touch config/DOCKER

RUN echo "{\"commitTag\": \"${COMMIT_TAG}\"}" > committag.json


FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache \
    tzdata tini fontconfig ttf-dejavu font-noto-emoji \
    cairo pango jpeg giflib pixman \
    ffmpeg python3 \
    && mkdir -p /usr/share/fonts/truetype/poster-fonts && \
    cd /usr/share/fonts/truetype/poster-fonts && \
    wget -q https://raw.githubusercontent.com/google/fonts/main/ofl/bebasneue/BebasNeue-Regular.ttf && \
    wget -q https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf && \
    wget -q https://raw.githubusercontent.com/google/fonts/main/ofl/creepster/Creepster-Regular.ttf && \
    wget -q https://raw.githubusercontent.com/google/fonts/main/ofl/bangers/Bangers-Regular.ttf && \
    wget -q https://raw.githubusercontent.com/google/fonts/main/ofl/abrilfatface/AbrilFatface-Regular.ttf && \
    wget -q https://raw.githubusercontent.com/google/fonts/main/ofl/lato/Lato-Regular.ttf && \
    wget -q https://raw.githubusercontent.com/google/fonts/main/ofl/pacifico/Pacifico-Regular.ttf && \
    wget -q https://raw.githubusercontent.com/google/fonts/main/ofl/greatvibes/GreatVibes-Regular.ttf && \
    wget -q https://raw.githubusercontent.com/google/fonts/main/ofl/nosifer/Nosifer-Regular.ttf && \
    wget -q https://raw.githubusercontent.com/google/fonts/main/ofl/bungee/Bungee-Regular.ttf && \
    wget -q https://raw.githubusercontent.com/google/fonts/main/ofl/pressstart2p/PressStart2P-Regular.ttf && \
    wget -q https://raw.githubusercontent.com/google/fonts/main/ofl/courierprime/CourierPrime-Regular.ttf && \
    wget -q "https://raw.githubusercontent.com/google/fonts/main/ofl/oswald/Oswald[wght].ttf" && \
    wget -q "https://raw.githubusercontent.com/google/fonts/main/ofl/fredoka/Fredoka[wdth,wght].ttf" && \
    wget -q "https://raw.githubusercontent.com/google/fonts/main/ofl/playfairdisplay/PlayfairDisplay[wght].ttf" && \
    wget -q "https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/Montserrat[wght].ttf" && \
    wget -q "https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto[wdth,wght].ttf" && \
    wget -q "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter[opsz,wght].ttf" && \
    wget -q "https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/JetBrainsMono[wght].ttf" && \
    wget -q "https://raw.githubusercontent.com/google/fonts/main/ofl/dancingscript/DancingScript[wght].ttf" && \
    wget -q "https://raw.githubusercontent.com/google/fonts/main/ofl/raleway/Raleway[wght].ttf" && \
    wget -q "https://raw.githubusercontent.com/google/fonts/main/ofl/orbitron/Orbitron[wght].ttf" && \
    wget -q "https://raw.githubusercontent.com/google/fonts/main/ofl/cinzel/Cinzel[wght].ttf" && \
    wget -q "https://raw.githubusercontent.com/google/fonts/main/ofl/cormorantgaramond/CormorantGaramond[wght].ttf" && \
    wget -q https://github.com/tonsky/FiraCode/releases/download/6.2/Fira_Code_v6.2.zip && \
    unzip -q Fira_Code_v6.2.zip && \
    mv ttf/FiraCode-Bold.ttf . && \
    rm -rf Fira_Code_v6.2.zip ttf/ woff/ woff2/ variable_ttf/ && \
    fc-cache -fv && \
    rm -rf /tmp/*

# Install Deno - yt-dlp requires a JS runtime as of 2025-11-12
RUN echo "@edge https://dl-cdn.alpinelinux.org/alpine/edge/main" >> /etc/apk/repositories && \
    echo "@edge https://dl-cdn.alpinelinux.org/alpine/edge/community" >> /etc/apk/repositories && \
    apk add --no-cache deno@edge

# Install latest yt-dlp directly from GitHub releases (more up-to-date than apk package)
RUN wget -q https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

COPY --from=build_image /app ./

ENTRYPOINT [ "/sbin/tini", "--" ]
CMD [ "yarn", "start" ]

EXPOSE 7171
