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
