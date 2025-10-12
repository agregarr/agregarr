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
