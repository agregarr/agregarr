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
