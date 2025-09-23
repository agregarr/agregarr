FROM node:18.18.2-bullseye-slim AS build_image

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libcairo2-dev \
    libpango1.0-dev \
    libvips-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY package.json yarn.lock ./
RUN CYPRESS_INSTALL_BINARY=0 yarn install --frozen-lockfile --network-timeout 1000000 --build-from-source

COPY . ./

ARG COMMIT_TAG
ENV COMMIT_TAG=${COMMIT_TAG}

RUN yarn build

# remove development dependencies
RUN yarn install --production --ignore-scripts --prefer-offline

RUN rm -rf src server .next/cache

RUN mkdir -p config && touch config/DOCKER

RUN echo "{\"commitTag\": \"${COMMIT_TAG}\"}" > committag.json


FROM node:18.18.2-bullseye-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    tzdata tini fontconfig fonts-dejavu-core fonts-noto-color-emoji wget libcairo2 libpango-1.0-0 libvips42 \
    && rm -rf /var/lib/apt/lists/* && mkdir -p /usr/share/fonts/truetype/poster-fonts && \
    # Download Google Fonts
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
    fc-cache -fv && \
    rm -rf /tmp/*

# copy from build image
COPY --from=build_image /app ./

ENTRYPOINT [ "/usr/bin/tini", "--" ]
CMD [ "yarn", "start" ]

EXPOSE 7171
