# [2.0.0](https://github.com/agregarr/agregarr/compare/v1.4.2...v2.0.0) (2025-12-16)


### Bug Fixes

* **collections:** fixes stale hubs data creating collections ([54c215e](https://github.com/agregarr/agregarr/commit/54c215e15e1352c536ea2e33f2dfff597b9b0f98))
* **coming soon:** add Deno for yt-dlp YouTube support ([8dd6dcb](https://github.com/agregarr/agregarr/commit/8dd6dcbd18776e4a981009ec199d20d3edc2585e)), closes [#115](https://github.com/agregarr/agregarr/issues/115)
* **coming soon:** adds Recently Added collection option to exclude Coming Soon placeholders ([9ef18b0](https://github.com/agregarr/agregarr/commit/9ef18b0a849a308c1315096a38562d189443cb98)), closes [#115](https://github.com/agregarr/agregarr/issues/115)
* **config:** enable wallpaper, theme, and summary for pre-existing collections ([785ba18](https://github.com/agregarr/agregarr/commit/785ba18638f5e4563601bef3091fb5d8b224a91a))
* **config:** fixes modal closing when dragging outside of boundary ([b722fe0](https://github.com/agregarr/agregarr/commit/b722fe00bdf001ec95767109ab808f2d4730e714)), closes [#114](https://github.com/agregarr/agregarr/issues/114)
* **dashboard:** adds tautulli setup error ([54f6402](https://github.com/agregarr/agregarr/commit/54f6402a09a7bf550d539ddfdf8b7e26f7127e82)), closes [#138](https://github.com/agregarr/agregarr/issues/138)
* **discovery:** fix default hubs being relinked unecessarily ([9354de7](https://github.com/agregarr/agregarr/commit/9354de7e0988dc78b06dd647c0cd2168ffc0bc13))
* **downloads:** adds more options to config form for downloads ([97f3668](https://github.com/agregarr/agregarr/commit/97f366866a461291c207acd84fbfea5fc2138fe3)), closes [#106](https://github.com/agregarr/agregarr/issues/106) [#131](https://github.com/agregarr/agregarr/issues/131)
* **duplicate titles:** adds checks for duplicate titles for pre-existing collections ([3013a20](https://github.com/agregarr/agregarr/commit/3013a2087dbc9754aaa9bf8edfc99139f46e3e11)), closes [#136](https://github.com/agregarr/agregarr/issues/136)
* **exclusions:** adds mutual exclusions to multi-source ([a862d09](https://github.com/agregarr/agregarr/commit/a862d0930c91548e1dfb31ec4ccfdde296f710b1)), closes [#115](https://github.com/agregarr/agregarr/issues/115)
* **filtered hubs:** ensure existing filtered hubs get updated ([aaf0c50](https://github.com/agregarr/agregarr/commit/aaf0c5084888e59ffc44a29db80f9fdd17286b89))
* **flix patrol:** fixes empty lists due to timezone/list publishing times ([87e31c6](https://github.com/agregarr/agregarr/commit/87e31c6719f246e16f0c0cfb9b8bca3589706f03)), closes [#139](https://github.com/agregarr/agregarr/issues/139)
* **flix patrol:** fixes table parsing for flix patrol ([783f7a8](https://github.com/agregarr/agregarr/commit/783f7a85dba133987d214dd83e5441c4ade0338a)), closes [#169](https://github.com/agregarr/agregarr/issues/169) [#172](https://github.com/agregarr/agregarr/issues/172)
* **imdb custom lists:** fixes all items not being grabbed from imdb list ([2c7f65a](https://github.com/agregarr/agregarr/commit/2c7f65af705e8f184aa0e3e565f4c90275e5f35b)), closes [#167](https://github.com/agregarr/agregarr/issues/167)
* **letterboxd matching:** improves letterboxd fuzzy matching ([02e8b3e](https://github.com/agregarr/agregarr/commit/02e8b3ea596da7035ff4f5369211b561714a10d4))
* **letterboxd:** fixes matching for items with inconsistent release year ([843c516](https://github.com/agregarr/agregarr/commit/843c5161c8043c93c85e6f20d45d270beab5fe01)), closes [#116](https://github.com/agregarr/agregarr/issues/116)
* **letterboxd:** fixes parsing of apostrophe ([bd92c80](https://github.com/agregarr/agregarr/commit/bd92c8047daf21a51d20fe4887b493ef03bdc3d1)), closes [#199](https://github.com/agregarr/agregarr/issues/199)
* **linking collections:** fixes name being propgated across all hubs when linking ([b0320e2](https://github.com/agregarr/agregarr/commit/b0320e218e8ae6f178ea5a09bfbbf4c174c03436))
* **linking hubs:** fixes corrupted linkId ([49666ee](https://github.com/agregarr/agregarr/commit/49666ee7b49877d31e12aa2463ade3b40c079e31))
* **metadata:** fixes wallpaper, theme, and summarry not applying to multi-source collections ([c1150b0](https://github.com/agregarr/agregarr/commit/c1150b0f8020816e5933e5a9e08c399edc91ed84)), closes [#194](https://github.com/agregarr/agregarr/issues/194)
* **migrations:** fix broken migrations ([dde3bbd](https://github.com/agregarr/agregarr/commit/dde3bbd8865afaf28de785dbe63a33ea3bd2e069))
* **minor fixes:** add editionTitle, remove duplicate poster storage intialisation ([0551af0](https://github.com/agregarr/agregarr/commit/0551af0027b16096573515a98d3c1b5601bda678))
* **missing collections:** adds auto-delete for missing pre-existing collections ([7852b7a](https://github.com/agregarr/agregarr/commit/7852b7ac7097d5f8fbf464c525cc4b9624e3da6f)), closes [#195](https://github.com/agregarr/agregarr/issues/195)
* **networks top 10:** fixes best match being overriden by library type ([7ee89b6](https://github.com/agregarr/agregarr/commit/7ee89b6738e26b3ca13d2fc58df812bceec174ec)), closes [#172](https://github.com/agregarr/agregarr/issues/172)
* **overlays:** add 25% opacity overlay for placeholder items ([a257322](https://github.com/agregarr/agregarr/commit/a25732281a9c1a3b2aa67aa1f0d0aab2742ad42b)), closes [#115](https://github.com/agregarr/agregarr/issues/115) [#144](https://github.com/agregarr/agregarr/issues/144)
* **overlays:** add corner radius options ([e9f8816](https://github.com/agregarr/agregarr/commit/e9f8816835171fd01dd4aa8c776e9b24f5b06540)), closes [#144](https://github.com/agregarr/agregarr/issues/144)
* **overlays:** add daysAgoNextSeason and fix AWAITING DOWNLOAD preset template ([9d2f6ae](https://github.com/agregarr/agregarr/commit/9d2f6aec8fec305aeb4fa34cb9e8ddc5eaef65fc))
* **overlays:** add live placeholder tracking, seperate out releaseDate ([6cda7b8](https://github.com/agregarr/agregarr/commit/6cda7b8347252a45ccb040a88972d7becb6768ba)), closes [#175](https://github.com/agregarr/agregarr/issues/175) [#178](https://github.com/agregarr/agregarr/issues/178) [#179](https://github.com/agregarr/agregarr/issues/179)
* **overlays:** add preset templates, refine UI ([428a0a7](https://github.com/agregarr/agregarr/commit/428a0a742666b841282b502474f955e65cbd8d8e))
* **overlays:** add TMDB TV series status conditions, variables and preset ([dea44dd](https://github.com/agregarr/agregarr/commit/dea44dd649b664a7acaf6b8c4858e9217eb3ba63)), closes [#171](https://github.com/agregarr/agregarr/issues/171)
* **overlays:** add TZ offset for release date calculation ([e1a7880](https://github.com/agregarr/agregarr/commit/e1a7880930e16a9c177e93a3d8a6d5b7a61a1a90)), closes [#115](https://github.com/agregarr/agregarr/issues/115) [#144](https://github.com/agregarr/agregarr/issues/144)
* **overlays:** adds option to use plex posters as base overlay poster ([9df021a](https://github.com/agregarr/agregarr/commit/9df021a1b6081c29be494b5c6a466e0c76ab9bef)), closes [#144](https://github.com/agregarr/agregarr/issues/144)
* **overlays:** adds poster reset option ([a6eef5a](https://github.com/agregarr/agregarr/commit/a6eef5a8bea79c9680aa071e9aa806a860ed3ca7)), closes [#144](https://github.com/agregarr/agregarr/issues/144)
* **overlays:** apply overlays during sync now skips if no overlays configured ([f2623e6](https://github.com/agregarr/agregarr/commit/f2623e63e95a005851124938549f5b283a01e10c)), closes [#144](https://github.com/agregarr/agregarr/issues/144)
* **overlays:** cleanup overlays from config on deletion ([ddfc86e](https://github.com/agregarr/agregarr/commit/ddfc86ea4f1451104ab422fed018f5ef3614846f)), closes [#144](https://github.com/agregarr/agregarr/issues/144)
* **overlays:** fix poster source setting not saving when re downloading ([5296c48](https://github.com/agregarr/agregarr/commit/5296c48f3bde9531f87d0af56192524bc49d68a4))
* **overlays:** fixes imdb top 250 conditions, monitored (placeholder) conditions ([0aa2296](https://github.com/agregarr/agregarr/commit/0aa2296bc6dcb7238f7ec2a6ef6990c2131fcdbc)), closes [#115](https://github.com/agregarr/agregarr/issues/115) [#144](https://github.com/agregarr/agregarr/issues/144)
* **overlays:** fixes overlays appearing incorrectly ([9d33b13](https://github.com/agregarr/agregarr/commit/9d33b1357ec861dd65ff6b53b4337a1094b30f81)), closes [#173](https://github.com/agregarr/agregarr/issues/173)
* **overlays:** fixes overlays not rendering in preview ([203e075](https://github.com/agregarr/agregarr/commit/203e075905df1fe4cd477de6332ba3a635616e95)), closes [#144](https://github.com/agregarr/agregarr/issues/144)
* **overlays:** fixes some fonts not working ([630e04a](https://github.com/agregarr/agregarr/commit/630e04a8a8be649cd338c66c1c8a9c9dd369d051)), closes [#144](https://github.com/agregarr/agregarr/issues/144)
* **overlays:** refactor types, fix overlays not receiving correct source, minor fixes ([fea363d](https://github.com/agregarr/agregarr/commit/fea363dc3ea750a89bcd38c1d06b4ef2d4027dae))
* **overlays:** remove incorrect application of overlays ([43b8e05](https://github.com/agregarr/agregarr/commit/43b8e0549cf8ffa9c66332e7f8ef088f5a55ca5f))
* **overlays:** rework conditions to more logical structure, multiple overlays fixes ([92d6318](https://github.com/agregarr/agregarr/commit/92d63185f0d9a0c3b18a545b2169a17601af2e28)), closes [#115](https://github.com/agregarr/agregarr/issues/115) [#128](https://github.com/agregarr/agregarr/issues/128) [#144](https://github.com/agregarr/agregarr/issues/144)
* **overseerr:** fixes overseerr userID being saved as undefined on failure, add debugging ([59f498a](https://github.com/agregarr/agregarr/commit/59f498a1e244e856aa427d87036b16b9baa13016)), closes [#73](https://github.com/agregarr/agregarr/issues/73)
* **overseerr:** fixes smart collections not having posters applied ([ac5e74b](https://github.com/agregarr/agregarr/commit/ac5e74b5190f8bf99fbd83f55bddf69b6f0354da))
* **overseerr:** server, root folder, and profiles can now be selected ([e4738ed](https://github.com/agregarr/agregarr/commit/e4738ed4e226d52afc3f9b587f77ffb68b7e0242)), closes [#131](https://github.com/agregarr/agregarr/issues/131)
* **placeholders:** add placeholder cleanup to quick collection sync ([7739fa6](https://github.com/agregarr/agregarr/commit/7739fa61f305a197675a3fcb47262760846018b9))
* **placeholders:** adds correct shared filtering function for tmdb coming soon ([e04518d](https://github.com/agregarr/agregarr/commit/e04518d562e11ccb9cbc21a74aa11320cbd666f4))
* **placeholders:** update placeholder edition to Trailer ([d108891](https://github.com/agregarr/agregarr/commit/d1088914c427a5940c2f220ac9048534b8298129))
* **plex libraries:** fixes plex libraries not saving on passive discovery ([9a8ffb9](https://github.com/agregarr/agregarr/commit/9a8ffb96b64bbb2c9aec8620dd8c4fec8ff18f95))
* **plex user restrictions:** fixes live tv setting being reset when updating label restrictions ([f37cc1e](https://github.com/agregarr/agregarr/commit/f37cc1e670aa6e506ece9ecb17010381f8c0edff)), closes [#145](https://github.com/agregarr/agregarr/issues/145)
* **poster editor:** change poster editor from fabric.js to react-konva ([ee0dd5d](https://github.com/agregarr/agregarr/commit/ee0dd5d7c81e08851cf1f8511bec9a12478e7b30)), closes [#115](https://github.com/agregarr/agregarr/issues/115)
* **poster overlays:** multiple overlays fixes ([435bcdf](https://github.com/agregarr/agregarr/commit/435bcdfc031b55af186151435b1efef8e9dcb9af)), closes [#168](https://github.com/agregarr/agregarr/issues/168) [#115](https://github.com/agregarr/agregarr/issues/115) [#144](https://github.com/agregarr/agregarr/issues/144)
* **poster storage:** add temp cleanup, add usage checker for posters before deletion ([da31ec4](https://github.com/agregarr/agregarr/commit/da31ec4e4509798ed23823e8c9d516ee58b1fe24))
* **poster templates:** fixes radial gradient background option ([f436b2f](https://github.com/agregarr/agregarr/commit/f436b2fb987621f58de5f9fa3976926cc9ada20f)), closes [#133](https://github.com/agregarr/agregarr/issues/133)
* **posters:** fixes slow lookup for coming soon items, adds plex poster to cleanup ([12abba4](https://github.com/agregarr/agregarr/commit/12abba4e1101ad96fcdc7262deee9ce1dad9e442))
* **posters:** revert null poster fallback for TMDB ([366b2a2](https://github.com/agregarr/agregarr/commit/366b2a2ade3a88c5a7ba66f43bbef43d16a76add)), closes [#144](https://github.com/agregarr/agregarr/issues/144)
* **radarr/sonarr list exclusions:** updates endpoints (non-paginated now deprecated) ([07f6ac1](https://github.com/agregarr/agregarr/commit/07f6ac174f27628e6b07dc8687aa0eda52f436dc)), closes [#163](https://github.com/agregarr/agregarr/issues/163)
* **ratings:** iMDb TV show ratings added, RT fallback added ([9b44106](https://github.com/agregarr/agregarr/commit/9b44106c8e18342329cd34cfc68ffdb5d7f61ccf)), closes [#130](https://github.com/agregarr/agregarr/issues/130)
* **reset:** adds reset button to Settings -> General ([0c7ae30](https://github.com/agregarr/agregarr/commit/0c7ae30cc0660b2c5385c9effedc728a746b4116)), closes [#117](https://github.com/agregarr/agregarr/issues/117)
* **saved posters:** refactor of poster system with database tracking and automatic discovery ([9debc2d](https://github.com/agregarr/agregarr/commit/9debc2d3e393639a3d0b7f461151c071d4190f8b))
* **smart collections:** adds max items for smart collections ([d8e8183](https://github.com/agregarr/agregarr/commit/d8e8183741ebb4bd6610477825793e1deab3c6f6))
* **smart collections:** adds recently released filtered hubs ([c238da9](https://github.com/agregarr/agregarr/commit/c238da9d8762a406df4cfda5ff9270f563e7e318)), closes [#128](https://github.com/agregarr/agregarr/issues/128) [#115](https://github.com/agregarr/agregarr/issues/115)
* **smart collections:** fixes smart collections feature not working for multi source collections ([6f8c07d](https://github.com/agregarr/agregarr/commit/6f8c07d58e6e9d02d941ab85363946432f50da87)), closes [#137](https://github.com/agregarr/agregarr/issues/137)
* **sonarr/radarr:** add options for monitoring, search, and season folders ([ac881c7](https://github.com/agregarr/agregarr/commit/ac881c729a9e8734bcfcbd9ce3b27357a7e7a69f)), closes [#153](https://github.com/agregarr/agregarr/issues/153)
* **sonarr:** add season folders option to config ([2a51f96](https://github.com/agregarr/agregarr/commit/2a51f96b9b87b68f6eda8959cc6b423bf354e5a0)), closes [#153](https://github.com/agregarr/agregarr/issues/153)
* **sonarr:** fixes missing anime option from sonarr settings ([007a5c1](https://github.com/agregarr/agregarr/commit/007a5c1968df59d8c15f044b06ff659b211a75c2)), closes [#126](https://github.com/agregarr/agregarr/issues/126)
* **sonarr:** fixes seasons not being monitored ([d015ca2](https://github.com/agregarr/agregarr/commit/d015ca2703e486722e6179154191d29ca7253d43)), closes [#160](https://github.com/agregarr/agregarr/issues/160) [#153](https://github.com/agregarr/agregarr/issues/153)
* **tmdb:** adds networks and companies support for custom lists ([effa172](https://github.com/agregarr/agregarr/commit/effa17284019e34169519edc60ed913e91383c43))
* **trakt:** adds recommended to multi-source, add OAuth setup validation ([2063242](https://github.com/agregarr/agregarr/commit/2063242bac13094b60d4b13f59b3c8fc6b2d775d))
* **unwatched:** unwatched collections now create smart collections based off labels ([4d5c600](https://github.com/agregarr/agregarr/commit/4d5c600627570bcb7596b2730d500d5eed31747b)), closes [#137](https://github.com/agregarr/agregarr/issues/137) [#134](https://github.com/agregarr/agregarr/issues/134)


### Features

* **background, theme, summary:** adds background, theme, and summary to config form ([3660622](https://github.com/agregarr/agregarr/commit/36606225e584e1fea4e3b44a3ec916363e7f565f)), closes [#63](https://github.com/agregarr/agregarr/issues/63)
* **bulk edit:** collections can now be edited in bulk ([7a5fe94](https://github.com/agregarr/agregarr/commit/7a5fe94259846c4a6937ed2988ba9277ee03073f)), closes [#124](https://github.com/agregarr/agregarr/issues/124)
* **exclusions:** adds collection mutual exclusion ([2ac987a](https://github.com/agregarr/agregarr/commit/2ac987a832e734a949b2dbade44fb6ac7152e815)), closes [#156](https://github.com/agregarr/agregarr/issues/156)
* **imdb rating filtering:** missing items can now be filtered by IMDb ratings ([789274d](https://github.com/agregarr/agregarr/commit/789274d47df10574f416f30cad8b8e093a900fe2)), closes [#130](https://github.com/agregarr/agregarr/issues/130)
* **item ordering:** lists can now be ordered by IMDb ratings ([6c4b230](https://github.com/agregarr/agregarr/commit/6c4b230d55185c7affc0e551646bd5c120e570fd)), closes [#39](https://github.com/agregarr/agregarr/issues/39)
* **missing items filtering:** adds language filter, adds exclude/exclude options ([5052cc2](https://github.com/agregarr/agregarr/commit/5052cc29bf7dff456c20b3da292416fc07457e38)), closes [#111](https://github.com/agregarr/agregarr/issues/111)
* **missing items:** season priority can now be selected when grabbing missing items ([cdcac39](https://github.com/agregarr/agregarr/commit/cdcac397f0cc01cf8412a126acc3271c70389d06)), closes [#83](https://github.com/agregarr/agregarr/issues/83)
* **placeholders:** create placeholders for missing items from any list ([6a757d8](https://github.com/agregarr/agregarr/commit/6a757d806b0491560ccfe0a86bcd4aa5d5b130b7)), closes [#115](https://github.com/agregarr/agregarr/issues/115) [#128](https://github.com/agregarr/agregarr/issues/128)
* **plex metadata:** adds hashing system for posters, wallpapers, and themes ([f459595](https://github.com/agregarr/agregarr/commit/f459595da4693410d6eb5487451df12159866f8d)), closes [#144](https://github.com/agregarr/agregarr/issues/144)
* **plex watchlist:** adds plex watchlist grabbing via overseerr and radarr/sonarr ([f13bba0](https://github.com/agregarr/agregarr/commit/f13bba07636c116a18276b5c1175343df9b49598))
* **poster languages:** adds option for poster languages under Settings -> General ([a017de4](https://github.com/agregarr/agregarr/commit/a017de4ea70015782541e27e350c5e3871bb3669)), closes [#144](https://github.com/agregarr/agregarr/issues/144)
* **poster overlays:** poster Overlays for individual items can now be created ([de8ed92](https://github.com/agregarr/agregarr/commit/de8ed928fe54286d9e0c299893b93d0ee839da66)), closes [#144](https://github.com/agregarr/agregarr/issues/144) [#115](https://github.com/agregarr/agregarr/issues/115) [#128](https://github.com/agregarr/agregarr/issues/128)
* **poster sources:** adds local poster source option ([9e15a66](https://github.com/agregarr/agregarr/commit/9e15a66ab717c9640cfd12fcfd3f2de494dc4d28)), closes [#144](https://github.com/agregarr/agregarr/issues/144)
* **poster templates:** collection poster templates can now be used for pre-existing collections ([8c9db85](https://github.com/agregarr/agregarr/commit/8c9db854b5deb353923820e427710b0d4f3964d3)), closes [#118](https://github.com/agregarr/agregarr/issues/118)
* **quick sync:** adds quick sync for collections and overlays ([c8fdc7b](https://github.com/agregarr/agregarr/commit/c8fdc7b1ac09ea607e835723d3978cb03872e87a))
* **rt rating filtering:** missing items can now be filtered by Rotten Tomatoes ratings ([178d9f7](https://github.com/agregarr/agregarr/commit/178d9f7482474634d6d09395891f1d3c1effd266)), closes [#119](https://github.com/agregarr/agregarr/issues/119)
* **sources:** new Coming Soon Collection - Creates collection based of monitored/upcoming items ([d1e7dc5](https://github.com/agregarr/agregarr/commit/d1e7dc5c24402b6f36e8051d91e27afa52b7c396)), closes [#115](https://github.com/agregarr/agregarr/issues/115)
* **tmdb franchise:** adds auto TMDB franchise collections ([6083a79](https://github.com/agregarr/agregarr/commit/6083a79f061bf86093331584ade20c48597a19c4)), closes [#129](https://github.com/agregarr/agregarr/issues/129)
* **trakt:** add recommendations collection type ([#193](https://github.com/agregarr/agregarr/issues/193), [#197](https://github.com/agregarr/agregarr/issues/197)) ([df99edd](https://github.com/agregarr/agregarr/commit/df99edd80790cdfdd233e9fc5a69b3a36cdb4fdf))
* **v2.0.0:** bump v2.0.0 ([453faa7](https://github.com/agregarr/agregarr/commit/453faa7b49f2928a8daee343ec471c31b70b23ce))


### BREAKING CHANGES

* **v2.0.0:** bump v2.0.0

## [1.4.2](https://github.com/agregarr/agregarr/compare/v1.4.1...v1.4.2) (2025-10-21)


### Bug Fixes

* **anilist:** anilist URL's with /search can now be added. fixes preview ([bde31c6](https://github.com/agregarr/agregarr/commit/bde31c67cb1e1defb864724e4e675f65866857ab)), closes [#110](https://github.com/agregarr/agregarr/issues/110)
* **anilist:** fixes preview collections and custom URL validation ([72238d7](https://github.com/agregarr/agregarr/commit/72238d787f5a4e0fe49fd9cbf56793be091a7e94)), closes [#109](https://github.com/agregarr/agregarr/issues/109)
* **config:** disables custom sync option for default hubs and pre-existing collections ([a015ee8](https://github.com/agregarr/agregarr/commit/a015ee84984537c522418a92a4d1f1f351db8b47))
* **config:** enables randomise order for default hubs and pre-existing collections ([0128a4d](https://github.com/agregarr/agregarr/commit/0128a4d17d9744165cf677d64e06218e41eee85a))
* **config:** fixes max seasons of 0 being treated as undefined and defaulting to 3 ([0d06340](https://github.com/agregarr/agregarr/commit/0d06340ad92e1611e2a7c1c7b01ffd43ac9a6ddd))
* **individual sync:** adds queue for individual syncs when main sync is running ([6687711](https://github.com/agregarr/agregarr/commit/6687711995dafbd62482548eb96242c21141b687))
* **item ordering:** improves sync time by selectively reordering items in collections ([bfa0eb8](https://github.com/agregarr/agregarr/commit/bfa0eb8f5f04513d1a881858f1b724c6e3dffaf7))
* **libraries:** non-show/movie libraries are now consistently ignored ([8ad31bb](https://github.com/agregarr/agregarr/commit/8ad31bb279f7c45180c4eb738452ecf45fe6acd8))
* **networks top 10:** fixes kids lists being included in list ([a5ecda5](https://github.com/agregarr/agregarr/commit/a5ecda562eaaafa84cfd06c4944c1e86bb9845d1)), closes [#105](https://github.com/agregarr/agregarr/issues/105)
* **plex libraries:** fixes non TV Show or Movies libraries appearing in UI and logs ([f2138a9](https://github.com/agregarr/agregarr/commit/f2138a959401274def013be271e13bb4bd4fb3ea))
* **plex restrictions:** fixes existing labels in plex restrictions not being preserved ([5803003](https://github.com/agregarr/agregarr/commit/58030032697f91b4435b76a120782cdb3e56684a)), closes [#107](https://github.com/agregarr/agregarr/issues/107)
* **posters:** network Top 10 multi source collections in cycle lists mode now uses correct poster ([4c4a656](https://github.com/agregarr/agregarr/commit/4c4a6560a62859c2a8b56039234876aa72b32406))
* **reordering:** fixes plex home/recommended reordering for large libraries with randomise order set ([9992d8d](https://github.com/agregarr/agregarr/commit/9992d8dd447ea45d40c875b4ed56e976722d0f81)), closes [#102](https://github.com/agregarr/agregarr/issues/102)
* **sonarr:** list exclusions in sonarr are now respected ([c07adf2](https://github.com/agregarr/agregarr/commit/c07adf23cdb09e6d7d977ba52949747cae2521f9))

## [1.4.1](https://github.com/agregarr/agregarr/compare/v1.4.0...v1.4.1) (2025-10-12)


### Bug Fixes

* **anime:** aniList and MAL configs now update successfully ([a9f7ca2](https://github.com/agregarr/agregarr/commit/a9f7ca2a5d75cd319f27ec4408dbbaf566ec449f))
* **api key validation:** source API keys/connections now correctly validate and throw proper errors ([a40b1d9](https://github.com/agregarr/agregarr/commit/a40b1d94771e77588d0a7ab64646b609ef85516e))
* **config:** adding/removing a library from a config now correctly adds/removes the relevant config ([f5a65dd](https://github.com/agregarr/agregarr/commit/f5a65dde439a3590345467a267523e333f30609e)), closes [#80](https://github.com/agregarr/agregarr/issues/80)

# [1.4.0](https://github.com/agregarr/agregarr/compare/v1.3.1...v1.4.0) (2025-10-11)


### Bug Fixes

* **config:** corrects title duplication detection for dynamic title ([91374f2](https://github.com/agregarr/agregarr/commit/91374f272499b771902ebb95c3d84dcbea911ec9))
* **episode multi-sourse:** adds episodes support to multi-source collections ([078e402](https://github.com/agregarr/agregarr/commit/078e402515bdea0b26eaf760d45d4d6e2f2f6809))
* **imdb:** adds mediaType to IMDb->TMDB ID resolution ([0382397](https://github.com/agregarr/agregarr/commit/0382397748542195bfc2986626c190e6a04079a8)), closes [#93](https://github.com/agregarr/agregarr/issues/93)
* **individual sync:** correctly isolates indivudal sync, adds better scheduling ([3d39a7e](https://github.com/agregarr/agregarr/commit/3d39a7e17ade45e3853c90fce11ab940ff50fd76)), closes [#76](https://github.com/agregarr/agregarr/issues/76)
* **letterboxd:** improves letterboxd tmdb matching ([ea94915](https://github.com/agregarr/agregarr/commit/ea94915ad4d0c79f169722d5d653f04e85d7786b)), closes [#82](https://github.com/agregarr/agregarr/issues/82)
* **linked collections:** corrects link button displaying on unlinkable collections ([d4703cf](https://github.com/agregarr/agregarr/commit/d4703cf2119c9a44f5a68f1f8adcf41f06b8f0da))
* **mdblist:** private MDBLists can now be added ([cb05b3f](https://github.com/agregarr/agregarr/commit/cb05b3f98b38fcf42de3196cb4dc45f858483d3f))
* **missing items:** missing items not being sent for networks ([2f17b3c](https://github.com/agregarr/agregarr/commit/2f17b3c901a86b933f4df13374dc81f2625fd8f7))
* **multi source:** lists in cycle mode now have dynamic title option ([db9ce78](https://github.com/agregarr/agregarr/commit/db9ce78e0d6f921d60cc698d603324327abf78d5))
* **multi-source:** adds grab missing items for multi source configs ([60343c5](https://github.com/agregarr/agregarr/commit/60343c5c2ea53a26613b2a2391fac018771cc61b)), closes [#91](https://github.com/agregarr/agregarr/issues/91)
* **overseerr:** adds .invalid to agregarr generated overseerr user emails ([56f519d](https://github.com/agregarr/agregarr/commit/56f519d5f9e08e63eca452c36ba18cbecac40cbe)), closes [#92](https://github.com/agregarr/agregarr/issues/92)
* **overseerr:** overseerr user is now correctly recreated if deleted ([f8f7add](https://github.com/agregarr/agregarr/commit/f8f7addf8c1152a7f01a4a26d57b1708df821832)), closes [#73](https://github.com/agregarr/agregarr/issues/73)
* **poster templates:** add import/export, add fonts, add layers (major rework) ([faa401a](https://github.com/agregarr/agregarr/commit/faa401a0408e99f875caddb54777b8e04ec234e1))
* **poster templates:** multiple template fixes ([aa82df7](https://github.com/agregarr/agregarr/commit/aa82df760f41b983d553879ff5f47fe30c31002f))
* **poster templates:** sliders for content grid now work correctly ([9cb4f6b](https://github.com/agregarr/agregarr/commit/9cb4f6b5f3a6d8b1dccd621c800fda07aafdb691))
* **radarr/sonarr tags:** adds tag options, fixes tags failing after first request ([3e61842](https://github.com/agregarr/agregarr/commit/3e61842200488a05a625e9467bb3d7623df451c3)), closes [#79](https://github.com/agregarr/agregarr/issues/79)
* **radarr/sonarr:** adds multiple radarr/sonarr servers, adds custom profile selection ([e1fff45](https://github.com/agregarr/agregarr/commit/e1fff45778f3c10b40b6e8802e6953197dc48ad3)), closes [#14](https://github.com/agregarr/agregarr/issues/14) [#71](https://github.com/agregarr/agregarr/issues/71)
* **radarr/sonarr:** corrects missing items from re-monitoring items in radarr/sonarr ([fb5bc08](https://github.com/agregarr/agregarr/commit/fb5bc0892cdd5cf8f2ad89893cc80131c0cf9319)), closes [#77](https://github.com/agregarr/agregarr/issues/77)
* **reordering:** removes default size limit to fix 413 errors in large libraries ([f2cde63](https://github.com/agregarr/agregarr/commit/f2cde6311b3fc6a4a37e31b1318cbd5fa1dd92b3)), closes [#95](https://github.com/agregarr/agregarr/issues/95)
* **sources:** max Items now fills the collection to the specified limit ([954f32b](https://github.com/agregarr/agregarr/commit/954f32bc84526c1b084444849841b676b570488d))
* **title template:** changes default title to be the same across libraries ([80cebd7](https://github.com/agregarr/agregarr/commit/80cebd793b0a55db8d30361598c2c95e9c0a29f4)), closes [#47](https://github.com/agregarr/agregarr/issues/47)
* **tmdb presets:** removed single page limit from preset tmdb lists ([0b0381d](https://github.com/agregarr/agregarr/commit/0b0381db754e80a9747da3a60786c8f63f567664)), closes [#86](https://github.com/agregarr/agregarr/issues/86)
* **tmdb:** add TMDB lists ([a499bf6](https://github.com/agregarr/agregarr/commit/a499bf620aefca66d64846d3ab1f9091c50e117f)), closes [#75](https://github.com/agregarr/agregarr/issues/75)


### Features

* **add anilist and mal:** adds AniList and MAL as sources ([908fc52](https://github.com/agregarr/agregarr/commit/908fc52bcf9409c650650f10c9453750df72c677)), closes [#35](https://github.com/agregarr/agregarr/issues/35)
* **country exclusion:** adds country exclusions for missing items ([6f31352](https://github.com/agregarr/agregarr/commit/6f313521af2003e6034f01f8b218003f9217dcb3))
* **genres:** adds option to exclude genres from missing items ([2c0ae08](https://github.com/agregarr/agregarr/commit/2c0ae0811c77f2c0b6b3c26b74f62ee33de38997)), closes [#85](https://github.com/agregarr/agregarr/issues/85)
* **item exclusions:** individual items can now be excluded from lists globally ([cb9774f](https://github.com/agregarr/agregarr/commit/cb9774f5de86119a6ee6ee3b72c7b1e6c3fcb1d4))
* **networks originals:** adds networks originals source type ([60facc9](https://github.com/agregarr/agregarr/commit/60facc912c38f3a250a0e1a215863b0d63fd4447)), closes [#72](https://github.com/agregarr/agregarr/issues/72)
* **preview collections:** adds collections preview modal ([a0cd481](https://github.com/agregarr/agregarr/commit/a0cd481fe7cf869091b084c16c3def3edc0ae9ee)), closes [#17](https://github.com/agregarr/agregarr/issues/17)
* **randomise order:** adds option to randomise collections on the home/recommended screens ([e7704b9](https://github.com/agregarr/agregarr/commit/e7704b90a3d3778dcd34bad70975daa2333462ff)), closes [#89](https://github.com/agregarr/agregarr/issues/89)
* **sources:** radarr and sonarr tags added as source ([2649962](https://github.com/agregarr/agregarr/commit/264996297eef5b81cf4464691a37f934c68c24e9)), closes [#8](https://github.com/agregarr/agregarr/issues/8)
* **unwatched filter:** adds unwatched option in config ([5db47da](https://github.com/agregarr/agregarr/commit/5db47da2c69d658088f2cae4707bafabdbe4d270)), closes [#51](https://github.com/agregarr/agregarr/issues/51)

## [1.3.1](https://github.com/agregarr/agregarr/compare/v1.3.0...v1.3.1) (2025-09-19)


### Bug Fixes

* **api keys:** add API key warnings ([bc4a170](https://github.com/agregarr/agregarr/commit/bc4a1700c6be674f104f6cb5b26db82ce3560a71))
* **auto poster:** removes auto poster option from pre-existing config form ([af9bd75](https://github.com/agregarr/agregarr/commit/af9bd75b457c9be936e7b95c8c39cc7b3e39fb48))
* **config:** checks for duplicate titles on creation ([dd5055e](https://github.com/agregarr/agregarr/commit/dd5055e35fb3663d07b37e6becf35b8725731e76))
* **plex collections:** collections are now correctly deleted when their config is removed ([03fecf0](https://github.com/agregarr/agregarr/commit/03fecf0ac28664c6389ffed3a01e0b1648f22c8f))
* **reordering:** pre-existing collections no longer break reordering ([8b3b1ee](https://github.com/agregarr/agregarr/commit/8b3b1ee92364aba65bf2236a6b1716bcedeeecd7)), closes [#62](https://github.com/agregarr/agregarr/issues/62) [#55](https://github.com/agregarr/agregarr/issues/55) [#54](https://github.com/agregarr/agregarr/issues/54)
* **sync:** missing items will no longer be sent in the ordering array ([f0352a5](https://github.com/agregarr/agregarr/commit/f0352a5ce3e6ea3d8de85d281df27f4b483ba878)), closes [#55](https://github.com/agregarr/agregarr/issues/55)

# [1.3.0](https://github.com/agregarr/agregarr/compare/v1.2.2...v1.3.0) (2025-09-19)


### Bug Fixes

* adds global networks ([bda6bf5](https://github.com/agregarr/agregarr/commit/bda6bf5df68614b6f3583eaa878175b49a8f585e))
* **caching:** add global library cache plus minor fixes ([3cb35eb](https://github.com/agregarr/agregarr/commit/3cb35eb3e0e574bfbcde505fd356acfcb736d4fe))
* **collection sync:** adds individual collection sync tracking and fixes ([ce479da](https://github.com/agregarr/agregarr/commit/ce479da9cf3fc9e0de8a5947c76f14319d561a67))
* **collection sync:** creating a collection with custom sync timing now adds it to the schedule ([b2d6cd0](https://github.com/agregarr/agregarr/commit/b2d6cd0b9d5569a13e640eae0dfbc6873722165a))
* **collection sync:** fixed auth for individual collections sync ([1383749](https://github.com/agregarr/agregarr/commit/1383749d8e7688405b959023f4067087c0074164))
* **collections:** episode based collections can now be created for trakt and imdb ([88e5ef3](https://github.com/agregarr/agregarr/commit/88e5ef3feffd5b8fee2b80387a05f61a7e14763a)), closes [#68](https://github.com/agregarr/agregarr/issues/68)
* **config form:** edit form now correctly fills sources for multiple sources collections ([4cbd251](https://github.com/agregarr/agregarr/commit/4cbd2516ab5989d4475242c8ad2c3b1bcb8e9b86))
* **config:** adds minimum year filter for missing items ([6b20a39](https://github.com/agregarr/agregarr/commit/6b20a3986bb2594539ac668412a6a27c116d42e6)), closes [#66](https://github.com/agregarr/agregarr/issues/66)
* **config:** increased max items from 1000 to 9999 ([12a4595](https://github.com/agregarr/agregarr/commit/12a45955e434d119089d9985d11e3827b8eec338)), closes [#65](https://github.com/agregarr/agregarr/issues/65)
* **connections:** remove port requirement from test endpoints ([8c001fe](https://github.com/agregarr/agregarr/commit/8c001fe0498e9201defdfdb9ac07e8e89f888531))
* **item matching:** items that appear across multiple libraries now match correctly ([bd23c1e](https://github.com/agregarr/agregarr/commit/bd23c1efcdbce791b5e2df801ff1d7b1f51b6e79))
* **library selection:** selecting all libraries now correctly selects all libraries ([8b53135](https://github.com/agregarr/agregarr/commit/8b53135fa31e8b8073417f043089cedb84f30fd3)), closes [#59](https://github.com/agregarr/agregarr/issues/59)
* **missing items:** prevent duplicate downloads by checking all Plex libraries ([9d2d2a5](https://github.com/agregarr/agregarr/commit/9d2d2a53fe2b98b7431a8746f5346645b49978f8)), closes [#19](https://github.com/agregarr/agregarr/issues/19)
* **overseerr:** server owner requests now correctly hidden from users ([d12ef17](https://github.com/agregarr/agregarr/commit/d12ef17552f2d4671609d5fcdf5367528ec8a936))
* **poster editor:** multiple fixes for poster template editor ([bdbbf3c](https://github.com/agregarr/agregarr/commit/bdbbf3cd081b24d5730fba29ae65525b7a3978c5))
* **poster editor:** multiple template fixes ([4993832](https://github.com/agregarr/agregarr/commit/4993832b2dfe4e9377e4fed972af6586b1d4c7eb))
* **poster editor:** poster template not working correctly for networks and multi-lists ([0836477](https://github.com/agregarr/agregarr/commit/0836477f933888bd3a7bade2d2ce4ecac2397fb0))
* **posters:** add emoji font package to dockerfile for posters ([1b3a844](https://github.com/agregarr/agregarr/commit/1b3a8445f57609b4a4889fd2310f12a2e594ff08))
* **posters:** preview posters display now show correctly ([cf52f24](https://github.com/agregarr/agregarr/commit/cf52f24bd4ec1b4e968c11f9c38b0b30ef67ac80))
* **random lists:** add custom random list files ([f44b85c](https://github.com/agregarr/agregarr/commit/f44b85cc979a8b2b0167d3e76e883f52aa000319))
* **random lists:** adds true random collections for trakt, imdb, letterboxd and tmdb ([91ac4cb](https://github.com/agregarr/agregarr/commit/91ac4cb5baa189218e3d2b7eee1ec1d6ceb41949))
* **sonarr:** prevent duplicate requests for existing series ([d5fe7e8](https://github.com/agregarr/agregarr/commit/d5fe7e864d740e2540575ee15decddb9b7983796)), closes [#60](https://github.com/agregarr/agregarr/issues/60)
* **template:** default template spacing ([0d8e638](https://github.com/agregarr/agregarr/commit/0d8e6387fab9b09d2868e716fb2546f58f43f34a))
* **version checking:** update semantic release build args to pass commit sha ([1a03e74](https://github.com/agregarr/agregarr/commit/1a03e7462fe9f699ddbd77d54d865de06a93f5ef))


### Features

* **collections sync:** adds individual collection syncing ([8c8edc4](https://github.com/agregarr/agregarr/commit/8c8edc4ce645bf6c4ff7612379035be0d4bdd17e)), closes [#26](https://github.com/agregarr/agregarr/issues/26)
* **mdblists:** add mdblists as a source ([935b279](https://github.com/agregarr/agregarr/commit/935b279da7ec4e5727b6b181be4b9c5fada625ac)), closes [#69](https://github.com/agregarr/agregarr/issues/69)
* **multi-lists:** collections can now be created with multiple sources ([9c438b3](https://github.com/agregarr/agregarr/commit/9c438b317bf1209fb7adeb81f87c30ae374dfb96)), closes [#50](https://github.com/agregarr/agregarr/issues/50)
* **network lists:** adds Networks source, with global and per-country options ([51976d4](https://github.com/agregarr/agregarr/commit/51976d4686c3e0bbe3571910d43b85fd4eff6d5a)), closes [#42](https://github.com/agregarr/agregarr/issues/42)
* **sources:** add random lists feature ([74a72c3](https://github.com/agregarr/agregarr/commit/74a72c3f194cfa4a256c571d44f153927a4ab35f))

## [1.2.2](https://github.com/agregarr/agregarr/compare/v1.2.1...v1.2.2) (2025-09-07)


### Bug Fixes

* **letterboxd lists:** web-scraping updated for letterbox lists ([ea6435b](https://github.com/agregarr/agregarr/commit/ea6435bea6ec1bc84edbc9bcea912f6f812c280e))
* **overseerr/tautulli connections test:** fixes port number conversion for test connection button ([2698a2c](https://github.com/agregarr/agregarr/commit/2698a2ce957010e472acdf0fcb094e633bdc0968)), closes [#33](https://github.com/agregarr/agregarr/issues/33)
* remove useSSL as required field from overseerr and tautulli test ([8fd9a00](https://github.com/agregarr/agregarr/commit/8fd9a0026f591413c4fd3d13c78bbf0be38bc1fc))

## [1.2.1](https://github.com/agregarr/agregarr/compare/v1.2.0...v1.2.1) (2025-09-04)


### Bug Fixes

* adds poster upload from URL ([51b69ee](https://github.com/agregarr/agregarr/commit/51b69eee52a12fcdf2348295c55dddf538de209e)), closes [#53](https://github.com/agregarr/agregarr/issues/53)
* collecions being marked as missing at the end of a sync ([a8d0869](https://github.com/agregarr/agregarr/commit/a8d0869fd4d95e9b2c4bb227a0fafa3bb935403f))
* collection hub discovery for deleted collections ([edb93fe](https://github.com/agregarr/agregarr/commit/edb93fecdca6bde34aa5d1e856664ca50b3899ec))
* custom posters being overwitten by autoposter ([586706b](https://github.com/agregarr/agregarr/commit/586706b4b349ba96b77ac6e32461b26a51d1ff99))
* **trakt lists:** adds support for official trakt lists ([d71862c](https://github.com/agregarr/agregarr/commit/d71862c637015bb399bf905e638c523d03bf9d56)), closes [#49](https://github.com/agregarr/agregarr/issues/49)
* update dockerfile for poster generation assets ([eda801f](https://github.com/agregarr/agregarr/commit/eda801f0b7859d2c44c769bd33aa7b6d1af24857))

# [1.2.0](https://github.com/agregarr/agregarr/compare/v1.1.0...v1.2.0) (2025-09-02)


### Features

* push new version ([086ab63](https://github.com/agregarr/agregarr/commit/086ab6334cc5e6252fa81bede3e9e48a945c165b))

# [1.1.0](https://github.com/agregarr/agregarr/compare/v1.0.4...v1.1.0) (2025-09-02)


### Bug Fixes

* correctly respects exclusion list in radarr/sonarr ([fd08dcc](https://github.com/agregarr/agregarr/commit/fd08dcc02d5861249f410312fafbd7d18eec6d76)), closes [#31](https://github.com/agregarr/agregarr/issues/31)
* custom collection media type detection ([2978996](https://github.com/agregarr/agregarr/commit/2978996fc20df7c6314c2cb0ebdfc74649eefc78)), closes [#44](https://github.com/agregarr/agregarr/issues/44)
* custom title not propogating to UI on save, fix linked editing ([78c45c9](https://github.com/agregarr/agregarr/commit/78c45c9905d2f55c264c53df9491575065986375)), closes [#29](https://github.com/agregarr/agregarr/issues/29) [#37](https://github.com/agregarr/agregarr/issues/37)
* discovery service promotion respecting plex order ([584cbb3](https://github.com/agregarr/agregarr/commit/584cbb3d7285249e5a1f5244589961a8e3949044))
* edit config propgation ([8446bf2](https://github.com/agregarr/agregarr/commit/8446bf2c299dac6114c38c5905ffecc4759e56db))
* iMDb list types ([7372ba5](https://github.com/agregarr/agregarr/commit/7372ba50f6976d797b7cc9f199a52031c7841eee)), closes [#7](https://github.com/agregarr/agregarr/issues/7)
* multiple minor fixes ([722b3e3](https://github.com/agregarr/agregarr/commit/722b3e37768a877f77c29217ea195251f749523d))
* multiple minor fixes ([f3f8499](https://github.com/agregarr/agregarr/commit/f3f84991aa18e02a8688168b1b5a264f3cae2c9f))
* plex home/recommended ordering ([f135273](https://github.com/agregarr/agregarr/commit/f135273ea79908c86c3e0d0712f3eb383705b3c7)), closes [#28](https://github.com/agregarr/agregarr/issues/28)
* prevent async discovery/collections sync, minor bug fixes ([d021a70](https://github.com/agregarr/agregarr/commit/d021a70d1bda360868661a3fe875e01b3d6305b4))
* refined linked default hubs logic ([2017cf3](https://github.com/agregarr/agregarr/commit/2017cf3a8c35c86d0a04c36a95c847481ae48fc4)), closes [#36](https://github.com/agregarr/agregarr/issues/36)
* skip TV shows with more than this many seasons not being respected ([4cc4ef6](https://github.com/agregarr/agregarr/commit/4cc4ef6ab77dc3a49d140a9d9c0c30714c88debe)), closes [#24](https://github.com/agregarr/agregarr/issues/24)


### Features

* add poster generationn and management ([b778430](https://github.com/agregarr/agregarr/commit/b778430ab399b730ddb0b8efd8aba22aef93e3f0)), closes [#45](https://github.com/agregarr/agregarr/issues/45)
* add season limit for tv shows ([0b74a4d](https://github.com/agregarr/agregarr/commit/0b74a4d758e1a737bfe907323b88b0283c0137aa)), closes [#27](https://github.com/agregarr/agregarr/issues/27)
* allow custom CRON expressions for Plex Collections Sync, update presets ([975e8b5](https://github.com/agregarr/agregarr/commit/975e8b50e3acd4c603515723cb1335db56507014)), closes [#23](https://github.com/agregarr/agregarr/issues/23)
* **component:** adds a configurable 'minimumPlays' field for Tautulli collections, defaulting to 3 ([257aae7](https://github.com/agregarr/agregarr/commit/257aae766bee375edac67975a36df2f335744cc8)), closes [#38](https://github.com/agregarr/agregarr/issues/38)
