## [2.4.1](https://github.com/agregarr/agregarr/compare/v2.4.0...v2.4.1) (2026-03-05)


### Bug Fixes

* **cleanup:** prevent auto-franchise collections from being deleted when custom sync is enabled  ([#470](https://github.com/agregarr/agregarr/issues/470)) ([4a4e1d8](https://github.com/agregarr/agregarr/commit/4a4e1d85c156824610b91d7ec9259ad87a4f6672))
* **collections:** index MAL IDs for constant-time lookups ([#482](https://github.com/agregarr/agregarr/issues/482)) ([831ccab](https://github.com/agregarr/agregarr/commit/831ccaba9864bd3c07f1569ebb8465e74fa0c63a)), closes [#480](https://github.com/agregarr/agregarr/issues/480)
* **coming-soon:** makes hideIndividualItems work for Coming Soon collections ([#469](https://github.com/agregarr/agregarr/issues/469)) ([069e58c](https://github.com/agregarr/agregarr/commit/069e58c174a6785ce74c38a267084e7da21ce250))
* **connections:** correctly handle CSRF cookie name ([843d314](https://github.com/agregarr/agregarr/commit/843d3149846d94be43a1bc09e098f4a3f688de91))
* guard splice in arrangeCollectionItemsInOrder ([#481](https://github.com/agregarr/agregarr/issues/481)) ([68d832a](https://github.com/agregarr/agregarr/commit/68d832a2bd1cd8acce107a1b95d382305ef50927))
* **local-posters:** fix pagination and library filtering for local poster folders ([#477](https://github.com/agregarr/agregarr/issues/477)) ([4f11ad1](https://github.com/agregarr/agregarr/commit/4f11ad12601dbfec964fc371a7ffc7c8bd62340f)), closes [#433](https://github.com/agregarr/agregarr/issues/433)
* **overlays:** correct air date today logic for next episode and season ([#496](https://github.com/agregarr/agregarr/issues/496)) ([207a1ed](https://github.com/agregarr/agregarr/commit/207a1ed905c83fe3228fe12f27dccc2e10146a25))
* **overlays:** fix days since season premiere logic ([#473](https://github.com/agregarr/agregarr/issues/473)) ([898c300](https://github.com/agregarr/agregarr/commit/898c300d2af46e6afe1d4c43b6def9d00ed0f840))
* **overlays:** move IMDb rating position out of conflict with top banner tiles ([#408](https://github.com/agregarr/agregarr/issues/408)) ([cb12822](https://github.com/agregarr/agregarr/commit/cb128228726f410d1fd9994878f568e404f10114))
* **overlays:** parallelise collection membership check in overlay test ([#483](https://github.com/agregarr/agregarr/issues/483)) ([5134db5](https://github.com/agregarr/agregarr/commit/5134db5b9f661023aa9d614b0806d00662084bae)), closes [#468](https://github.com/agregarr/agregarr/issues/468)
* **overlays:** support Maintainerr v3 API (mediaServerId rename) ([#504](https://github.com/agregarr/agregarr/issues/504)) ([8d85032](https://github.com/agregarr/agregarr/commit/8d850322b994ac76663b3a1491f47c6037fc3a50)), closes [#501](https://github.com/agregarr/agregarr/issues/501)
* **placeholders:** handle Plex returning TV seasons as Children.Directory ([#491](https://github.com/agregarr/agregarr/issues/491)) ([d8655ca](https://github.com/agregarr/agregarr/commit/d8655cad411247d0f58e0aa0f84125f0a2f6a769)), closes [#414](https://github.com/agregarr/agregarr/issues/414)
* **Placeholders:** Scan all placeholder-enabled libraries, not just the first ([#467](https://github.com/agregarr/agregarr/issues/467)) ([77c5a91](https://github.com/agregarr/agregarr/commit/77c5a91139cbf0cba1f1051985f385095c548e48))
* **Placeholders:** Separate placeholder filters independent of auto-request filters ([#456](https://github.com/agregarr/agregarr/issues/456)) ([63b8851](https://github.com/agregarr/agregarr/commit/63b8851a1ae7138780c935e75803adc96c78e585))
* **tmdb-collections:** respect language setting for TMDB franchise collections ([78842cd](https://github.com/agregarr/agregarr/commit/78842cd050153b564aa4eee7ea49333189c828d4)), closes [#487](https://github.com/agregarr/agregarr/issues/487)
* **TMDB:** Multiple custom advanced filter fixes  ([#476](https://github.com/agregarr/agregarr/issues/476)) ([863d997](https://github.com/agregarr/agregarr/commit/863d9974be2b42b62c98207e61e013f1e8f14f4f))
* **uploads:** add authentication to poster export/import, trakt, and anime routes ([aba123f](https://github.com/agregarr/agregarr/commit/aba123fcc5c93ba5842e77b8b31cf67ecc5dc7b1))

# [2.4.0](https://github.com/agregarr/agregarr/compare/v2.3.0...v2.4.0) (2026-02-15)


### Bug Fixes

* **api:** pass options to ExternalAPI constructor correctly ([#413](https://github.com/agregarr/agregarr/issues/413)) ([e482b58](https://github.com/agregarr/agregarr/commit/e482b58a290560615bb6f79792b5ce5e06f36f90))
* **cleanup:** prevent auto franchise collections from being deleted during full sync ([eb22483](https://github.com/agregarr/agregarr/commit/eb2248355358e05dff9a41c7c71d64fb760d491b))
* **collection-poster-editor:** fixes preview not resetting. adds library categorisation to dropdown ([536d373](https://github.com/agregarr/agregarr/commit/536d3733a2141701778e08641c1d13dd5af2c99a)), closes [#373](https://github.com/agregarr/agregarr/issues/373)
* **collection-posters:** update hbo max poster template logo, colors ([#407](https://github.com/agregarr/agregarr/issues/407)) ([9c345f6](https://github.com/agregarr/agregarr/commit/9c345f6622e9320025f7ca3d9fae08e088746a6a))
* **collections:** use correct Plex API endpoint for collection title updates ([#444](https://github.com/agregarr/agregarr/issues/444)) ([a6e3e01](https://github.com/agregarr/agregarr/commit/a6e3e017bdad622083ac5ca19a17ffc9e6003e92)), closes [#432](https://github.com/agregarr/agregarr/issues/432)
* **filtered-hub:** use episode air date for TV recently released ([#450](https://github.com/agregarr/agregarr/issues/450)) ([ecda355](https://github.com/agregarr/agregarr/commit/ecda35507c4c2ee646264b15c998363bb1c78bc5)), closes [#442](https://github.com/agregarr/agregarr/issues/442)
* **letterboxd:** improve TMDB matching with year-aware search and scoring ([9016bd9](https://github.com/agregarr/agregarr/commit/9016bd98f39e0ec80c5ef57f387673c4b6e9cdbb)), closes [#236](https://github.com/agregarr/agregarr/issues/236)
* **letterboxd:** resolve letterboxd items via film page TMDB links ([#454](https://github.com/agregarr/agregarr/issues/454)) ([968d424](https://github.com/agregarr/agregarr/commit/968d4246f5156e08a6d926fb1d5659e08185a873)), closes [#448](https://github.com/agregarr/agregarr/issues/448)
* **multi-source:** fixes collection title not updating when changed ([b510fdc](https://github.com/agregarr/agregarr/commit/b510fdc9f29452282918eacfedc075cebc136836)), closes [#425](https://github.com/agregarr/agregarr/issues/425)
* **overlays:** add TVDB TV Status as additional TV Status option ([9b272e3](https://github.com/agregarr/agregarr/commit/9b272e37b1723bb8a4a22f9b9859746a28f42610)), closes [#342](https://github.com/agregarr/agregarr/issues/342)
* **overlays:** fix infinite update loop ([8742901](https://github.com/agregarr/agregarr/commit/874290155a27a7c976a4a4149b7678d0442bc9a1))
* **overlays:** fix native language strings being used for language/subtitle variables ([888dc43](https://github.com/agregarr/agregarr/commit/888dc43301cfbb85e6ad051a279a485304a73e6b)), closes [#460](https://github.com/agregarr/agregarr/issues/460)
* **overlays:** fix release time to 12:00:00 (midday) to ensure accurate TZ adjustment ([047586c](https://github.com/agregarr/agregarr/commit/047586c2f5a27fdeda39c0ca0ab6a84199c97ec0)), closes [#422](https://github.com/agregarr/agregarr/issues/422)
* pass rating filters and seasonGrabOrder to multi-source collections ([#459](https://github.com/agregarr/agregarr/issues/459)) ([e0470bc](https://github.com/agregarr/agregarr/commit/e0470bcb0a9f93532254298b2704b1b8d300ea0d)), closes [#440](https://github.com/agregarr/agregarr/issues/440)
* persist applyOverlaysDuringSync for pre-existing collections ([#445](https://github.com/agregarr/agregarr/issues/445)) ([6b89f60](https://github.com/agregarr/agregarr/commit/6b89f60983394e48a320cf3b4780a3ff0a95ab59)), closes [#438](https://github.com/agregarr/agregarr/issues/438)
* **placeholders:** fixes placeholders not being added to multiple collections ([596f559](https://github.com/agregarr/agregarr/commit/596f5596d18f1b7c84beca6d1bb6d46ec567c2b4))
* **radarr-sonarr:** show auto-generated tag in collection config ([627eb99](https://github.com/agregarr/agregarr/commit/627eb99fae97585b72eb025c142d48bfcdf879a2))
* **randomise-home-order:** process libraries separately and shuffle non-contiguous items ([e3e5514](https://github.com/agregarr/agregarr/commit/e3e55148cddbba2afc45a0a9c3590f0db9ce5ed1)), closes [#226](https://github.com/agregarr/agregarr/issues/226)
* re-apply placeholder markers during global discovery ([#453](https://github.com/agregarr/agregarr/issues/453)) ([87087cb](https://github.com/agregarr/agregarr/commit/87087cbb6cc503e4546371012ac353dd7744bad4)), closes [#414](https://github.com/agregarr/agregarr/issues/414)
* use searchPerson API for person spotlight TMDB disambiguation ([#452](https://github.com/agregarr/agregarr/issues/452)) ([bf569ae](https://github.com/agregarr/agregarr/commit/bf569aea54bee3e97c0c59d65ccfea6494100223)), closes [#443](https://github.com/agregarr/agregarr/issues/443)
* **watchlist:** add username tags option for grabbing missing items from watchlist ([2acad01](https://github.com/agregarr/agregarr/commit/2acad0162c0333958154e608e5c250440e4c4236)), closes [#427](https://github.com/agregarr/agregarr/issues/427)
* **watchlist:** fixes plex watchlist not respecting radarr/sonarr exclusions ([31427a8](https://github.com/agregarr/agregarr/commit/31427a8dcc730d0f215a21a147635475aa4a47f3)), closes [#429](https://github.com/agregarr/agregarr/issues/429)


### Features

* **collections:** Add custom TMDB Collection Builder ([#416](https://github.com/agregarr/agregarr/issues/416)) ([3668ec2](https://github.com/agregarr/agregarr/commit/3668ec293117a376236ab0fa1410d3751db28c4f))
* **collections:** items that fall off collections now have a label 'agregarr-stale' added ([84db0e2](https://github.com/agregarr/agregarr/commit/84db0e23c29e3e3e3b28fc78253490a1b057b94f)), closes [#384](https://github.com/agregarr/agregarr/issues/384)
* **coming-soon:** coming soon collections can now be filtered by Radarr/Sonarr server and tags ([a02e547](https://github.com/agregarr/agregarr/commit/a02e5475f05dee11d20a1c8fd4f4657d305f966b)), closes [#406](https://github.com/agregarr/agregarr/issues/406) [#411](https://github.com/agregarr/agregarr/issues/411)
* **missing-items:** tMDB Keyword added to allow for more advanced filtering ([5745991](https://github.com/agregarr/agregarr/commit/5745991f46f17454d15e3d96d3bda4ac6813774d)), closes [#256](https://github.com/agregarr/agregarr/issues/256)
* **overlays:** add 'mapped icons' element, allowing variables to be mapped to icons ([09f1dbb](https://github.com/agregarr/agregarr/commit/09f1dbbac66dd4ffd9899187eb81f4635a0fd0ce))
* **overlays:** add ability to tag and sort overlays. add grid size option ([4baa263](https://github.com/agregarr/agregarr/commit/4baa26302ce0b72c65056a51db2921430920627b)), closes [#376](https://github.com/agregarr/agregarr/issues/376) [#435](https://github.com/agregarr/agregarr/issues/435)
* **overlays:** add Collection as condition ([af965b6](https://github.com/agregarr/agregarr/commit/af965b66c6605ffc4d15c1c402272ad3fbd01e23)), closes [#243](https://github.com/agregarr/agregarr/issues/243)
* **overlays:** add date format options for US and UK/AU locales ([#446](https://github.com/agregarr/agregarr/issues/446)) ([e81b1d5](https://github.com/agregarr/agregarr/commit/e81b1d59526630e8a3d50aa5cdcdaca0f52c0037)), closes [#430](https://github.com/agregarr/agregarr/issues/430)
* **overlays:** add Plex Labels as condition ([9787db3](https://github.com/agregarr/agregarr/commit/9787db3bda6afdac46271fc350e761a76e15be99)), closes [#243](https://github.com/agregarr/agregarr/issues/243)
* **overlays:** add RT Verified Hot support and preset ([9962d5e](https://github.com/agregarr/agregarr/commit/9962d5e0efeca81513e74c0f3441e08f335c5ad8)), closes [#394](https://github.com/agregarr/agregarr/issues/394)
* **radarr-sonarr:** add option to tag existing media ([a87ab25](https://github.com/agregarr/agregarr/commit/a87ab2557d3f9f17bcb07a6376cc12fabc77c02d)), closes [#248](https://github.com/agregarr/agregarr/issues/248)
* **tags:** tags can now be created directly in agregarr ([f7083d7](https://github.com/agregarr/agregarr/commit/f7083d760b9b48a957d7bb354686a8446722dbf6))
* **tautulli:** add 'Most Watched' collection by Play Count or Watch Duration ([9b0d319](https://github.com/agregarr/agregarr/commit/9b0d319102e050077a669ee85750b14c545c6de5)), closes [#426](https://github.com/agregarr/agregarr/issues/426)


### Performance Improvements

* **overlays:** batch composite all template overlays in single render pass ([def2716](https://github.com/agregarr/agregarr/commit/def271603f63bd8fac27b3d9787e5a4995d92f35))

# [2.3.0](https://github.com/agregarr/agregarr/compare/v2.2.1...v2.3.0) (2026-01-22)


### Bug Fixes

* **collection-posters:** add pre-existing collections to preview, add real posters to content grid ([92db735](https://github.com/agregarr/agregarr/commit/92db73514ee3861967a7a9efe25248f04e47ac60)), closes [#373](https://github.com/agregarr/agregarr/issues/373)
* **collections:** don't double-estimate digital release dates ([#349](https://github.com/agregarr/agregarr/issues/349)) ([be758cb](https://github.com/agregarr/agregarr/commit/be758cbf659ebb7866ac49b2b6bfe704c8a56f14))
* **deps:** downgrade @semantic-release/github to 11.0.6 for Node 20 compatibility ([84138da](https://github.com/agregarr/agregarr/commit/84138dab9cb1e71296bc71e9d54862704ac087eb))
* **letterboxd:** add cloudflare solver for leterboxd ([bff75b8](https://github.com/agregarr/agregarr/commit/bff75b8111528a1283e85a7a1121f71d8a88bec2)), closes [#402](https://github.com/agregarr/agregarr/issues/402)
* **letterboxd:** extract title from data-item-name instead of img alt ([#405](https://github.com/agregarr/agregarr/issues/405)) ([db4c17a](https://github.com/agregarr/agregarr/commit/db4c17a1bae154ec2a41c8db73017b272c5681d8))
* **metadata:** fix incorrect release date for old releases with single modern digital release date ([cdb87f5](https://github.com/agregarr/agregarr/commit/cdb87f5eb9820d7e086f5dc9d5adf21d79dd6255)), closes [#374](https://github.com/agregarr/agregarr/issues/374)
* **overlays:** add 'does not contain' string operator ([fad6454](https://github.com/agregarr/agregarr/commit/fad645485bb88dc3662455add641d3a9fdf54bd5)), closes [#367](https://github.com/agregarr/agregarr/issues/367)
* **overlays:** add language and subtitle variables ([ea2e468](https://github.com/agregarr/agregarr/commit/ea2e468dfb8719d37780bcd9f9f668fb7cfdd473)), closes [#389](https://github.com/agregarr/agregarr/issues/389)
* **overlays:** fixes focus issue in condition editor ([c093e60](https://github.com/agregarr/agregarr/commit/c093e60b671528efffe64040a93e04438439476b)), closes [#375](https://github.com/agregarr/agregarr/issues/375)
* **overlays:** proxy plex posters through backend ([b285f29](https://github.com/agregarr/agregarr/commit/b285f290a7bfc33f6d01fa085dcb0acafc01a96e)), closes [#381](https://github.com/agregarr/agregarr/issues/381)
* **placeholders:** empty Plex trash after placeholder cleanup ([#400](https://github.com/agregarr/agregarr/issues/400)) ([d17d872](https://github.com/agregarr/agregarr/commit/d17d8728e942a5d9924cde8d2c276250c3fbe634))
* **placeholders:** skip date filtering for non-Coming-Soon collections with includeAllReleasedItems ([#387](https://github.com/agregarr/agregarr/issues/387)) ([56432fd](https://github.com/agregarr/agregarr/commit/56432fd273297615505cbc8e137e534e425418d1)), closes [#336](https://github.com/agregarr/agregarr/issues/336)
* **settings:** add seasonGrabOrder and minimumRottenTomatoesAudienceRating to multi-source ([5af35df](https://github.com/agregarr/agregarr/commit/5af35df5a60a79f79f96ce7a500d3c345b85523d)), closes [#242](https://github.com/agregarr/agregarr/issues/242)
* **sonarr:** add all sonarr mointoring options to main settings and collection config ([9087e84](https://github.com/agregarr/agregarr/commit/9087e84a9f6f121bd665e3d6ddf72e35f8288f4b)), closes [#397](https://github.com/agregarr/agregarr/issues/397)


### Features

* **trakt:** add Trakt watchlist support (via OAuth) ([8b1d1c6](https://github.com/agregarr/agregarr/commit/8b1d1c67a5cd997bbd8228b904f84d5d0c846a84)), closes [#377](https://github.com/agregarr/agregarr/issues/377)

## [2.2.1](https://github.com/agregarr/agregarr/compare/v2.2.0...v2.2.1) (2026-01-15)


### Bug Fixes

* **imdb:** replace ExternalAPI with ImdbAxiosClient for improved list fetching ([4e4edb5](https://github.com/agregarr/agregarr/commit/4e4edb5f2a84a120b919822f1cb5953753042f50))
* **placeholders:** add includeAllReleasedItems to sync and settings ([0783c06](https://github.com/agregarr/agregarr/commit/0783c0692ff731bc6ed5e0c7abdd75b606558f24))
* **workflow:** improve release workflow with version check and discord notifications ([#369](https://github.com/agregarr/agregarr/issues/369)) ([1ed2520](https://github.com/agregarr/agregarr/commit/1ed2520587be713da2cc601f7345c47ce09335d2))
* **workflows:** update version number in package.json before build and push ([2f0f6fa](https://github.com/agregarr/agregarr/commit/2f0f6fa4561202daad4f5b62dba8460e1f799289))

# [2.2.0](https://github.com/agregarr/agregarr/compare/v2.1.0...v2.2.0) (2026-01-14)


### Bug Fixes

* **api:** Sanitize error responses to prevent information disclosure ([#282](https://github.com/agregarr/agregarr/issues/282)) ([a4e6eba](https://github.com/agregarr/agregarr/commit/a4e6ebaecddad56d3e813d27074759df782c2b23))
* **bulk-edit:** Fix Firefox bulk edit table rendering issue ([#271](https://github.com/agregarr/agregarr/issues/271)) ([47465ea](https://github.com/agregarr/agregarr/commit/47465ea6c7d75a507dafde5b0638e9dd783584e1)), closes [#270](https://github.com/agregarr/agregarr/issues/270)
* **collection-posters:** exclude items without tmdb poster path in content grid ([8e105d9](https://github.com/agregarr/agregarr/commit/8e105d93c2e59acc8eb4bcf05784f0a5750cd570)), closes [#288](https://github.com/agregarr/agregarr/issues/288)
* **collection-posters:** fixes custom icons not being saved correctly ([e370b71](https://github.com/agregarr/agregarr/commit/e370b712078ea52872badb57fc5b2aeace4eb93b)), closes [#308](https://github.com/agregarr/agregarr/issues/308)
* **collection-posters:** fixes network logo mapping ([4573668](https://github.com/agregarr/agregarr/commit/4573668623efd11759fdafd12e5473890288706c)), closes [#361](https://github.com/agregarr/agregarr/issues/361)
* **collections-quick-sync:** add overseerr and tmdb autoFranchise support. refactor to use ratingKey ([5ae10be](https://github.com/agregarr/agregarr/commit/5ae10be8ceaaa7f4b9d253dbf5a9ddc825acf24e)), closes [#295](https://github.com/agregarr/agregarr/issues/295)
* **collections:** filter daily shows from Coming Soon collections ([#278](https://github.com/agregarr/agregarr/issues/278)) ([5daf4fe](https://github.com/agregarr/agregarr/commit/5daf4fe78e818e5f554c3b0d9fdd3926fd911b65))
* **collections:** fixes incorrect ratingKey being saved when editing linked configs ([aadcbf4](https://github.com/agregarr/agregarr/commit/aadcbf4a530b9fd98358326a2cb59c1c9a8eb1c3)), closes [#120](https://github.com/agregarr/agregarr/issues/120)
* **collections:** surface per-collection sync errors to UI ([#321](https://github.com/agregarr/agregarr/issues/321)) ([4541ea1](https://github.com/agregarr/agregarr/commit/4541ea145c1124d9ef4b46995216401e1ef4944c)), closes [#299](https://github.com/agregarr/agregarr/issues/299)
* **collections:** sync networksCountry to sources array on change ([#304](https://github.com/agregarr/agregarr/issues/304)) ([be4e100](https://github.com/agregarr/agregarr/commit/be4e100ec817a3237dbec46847f21c32a9b3fef7)), closes [#296](https://github.com/agregarr/agregarr/issues/296)
* **config:** fix undefined custom url react error, enhance toasts ([33ba3d8](https://github.com/agregarr/agregarr/commit/33ba3d8ca9914e3ce950e24432e658725be7f6ec))
* **custom-lists:** refactor validation to include SSE messaging. fix fetch title for imdb ([d56d213](https://github.com/agregarr/agregarr/commit/d56d213d98befeeb6c1a0380f1f8925ea98b4568)), closes [#344](https://github.com/agregarr/agregarr/issues/344)
* **github-actions:** integrate semantic-release-action and add GitHub release step ([52b266b](https://github.com/agregarr/agregarr/commit/52b266b3850705dd7c4f0d15d63817586dc46f13))
* **imdb:** add AWS WAF challenge solver, fixing all IMDb lists ([459b9e3](https://github.com/agregarr/agregarr/commit/459b9e339ebe4cbf2352c71b2d068ac194f306de))
* **imdb:** add watchlist support ([d9c6e2f](https://github.com/agregarr/agregarr/commit/d9c6e2f7f8d4f5e546e19e808c22115b63ef5267)), closes [#343](https://github.com/agregarr/agregarr/issues/343)
* **imdb:** fix url validation ([56e046d](https://github.com/agregarr/agregarr/commit/56e046de12168b447c7c6b35e80d5e62dc67d794)), closes [#362](https://github.com/agregarr/agregarr/issues/362)
* **item-ordering:** add A-Z and Z-A sort order options ([5e33c61](https://github.com/agregarr/agregarr/commit/5e33c6167dd296db825e5cc6f3d170e75c9405e1)), closes [#341](https://github.com/agregarr/agregarr/issues/341)
* **item-ordering:** fix original plex order overriding source order ([b02e767](https://github.com/agregarr/agregarr/commit/b02e767e9a241572ca451198095d9a0cb605a47a)), closes [#225](https://github.com/agregarr/agregarr/issues/225)
* **letterboxd:** add support for /{user}/films/ URL's ([44e6c16](https://github.com/agregarr/agregarr/commit/44e6c163f95d60e38f49a855a11a69006e7c5929)), closes [#311](https://github.com/agregarr/agregarr/issues/311)
* **letterboxd:** fix mixed lists in letterboxd ([91f7484](https://github.com/agregarr/agregarr/commit/91f7484904da0c15fe359480f58d87abead78837)), closes [#236](https://github.com/agregarr/agregarr/issues/236)
* **logging:** downgrade library mismatch message to debug level ([#305](https://github.com/agregarr/agregarr/issues/305)) ([027bf11](https://github.com/agregarr/agregarr/commit/027bf11474ade46fe2057e6e30ad0bdfe5a67dd2)), closes [#265](https://github.com/agregarr/agregarr/issues/265)
* **mdblist:** fix mdblist for multi-source collections ([030c928](https://github.com/agregarr/agregarr/commit/030c9288445ad4c977d5a6451d818f4fd99f2e00)), closes [#299](https://github.com/agregarr/agregarr/issues/299)
* **missing-item-filter:** change from include to exclude when ratings return null/undefined ([e8b4027](https://github.com/agregarr/agregarr/commit/e8b40272e1de76ef003eaeb23635e9c7f0ff8f8d))
* **missing-items-filtering:** country and language dropdowns now include the full list ([7a5804e](https://github.com/agregarr/agregarr/commit/7a5804e73e3cd93793bbb39c2d69b2f566f13b5f)), closes [#337](https://github.com/agregarr/agregarr/issues/337)
* multi-source label regex for collection matching ([#345](https://github.com/agregarr/agregarr/issues/345)) ([5150bc7](https://github.com/agregarr/agregarr/commit/5150bc790dd0d64c46cda5eff9bae9e19eed73e0))
* **overlays:** add networks context ([da1095f](https://github.com/agregarr/agregarr/commit/da1095f9471847b8e3955ddcb88890b3646d8574)), closes [#286](https://github.com/agregarr/agregarr/issues/286)
* **overlays:** add runtime HHMM (eg 2h 16m) ([30ab2fc](https://github.com/agregarr/agregarr/commit/30ab2fc4727d01c658a81763c9a35921e9b26e9d)), closes [#301](https://github.com/agregarr/agregarr/issues/301)
* **overlays:** fetch Maintainerr collections in overlay test route ([#303](https://github.com/agregarr/agregarr/issues/303)) ([e33e641](https://github.com/agregarr/agregarr/commit/e33e641a2f9837554d0059cb6ca3c9e80219958f)), closes [#291](https://github.com/agregarr/agregarr/issues/291)
* **overlays:** return episodeNumber from fetchReleaseDateInfo for countdown overlays ([#302](https://github.com/agregarr/agregarr/issues/302)) ([70eb909](https://github.com/agregarr/agregarr/commit/70eb9091cf9cec4597023597ba84c727863bf15c)), closes [#290](https://github.com/agregarr/agregarr/issues/290)
* **overlays:** use uniform scaling for non-standard poster aspect ratios ([#306](https://github.com/agregarr/agregarr/issues/306)) ([5a19db7](https://github.com/agregarr/agregarr/commit/5a19db7efe51c662111dc98fc11a1f63dc5130e9)), closes [#297](https://github.com/agregarr/agregarr/issues/297)
* **overseerr:** disable notifications for overseerr users ([e621b75](https://github.com/agregarr/agregarr/commit/e621b7554f87a0c558da8e474f2d3c59f98840e1)), closes [#240](https://github.com/agregarr/agregarr/issues/240)
* **overseerr:** fix plexClient and libraryCache not being passed to sync ([9600cb2](https://github.com/agregarr/agregarr/commit/9600cb245bae5a2b2e5cb27ade414e89f6f15167)), closes [#363](https://github.com/agregarr/agregarr/issues/363)
* **overseerr:** fixes delete button. minor UI changes ([720988f](https://github.com/agregarr/agregarr/commit/720988f6d221f4aa80f3824c850063c8bc7785eb)), closes [#318](https://github.com/agregarr/agregarr/issues/318)
* **placeholders:** add check for plex poster, apply TMDB poster if not present ([af701fc](https://github.com/agregarr/agregarr/commit/af701fc0457ccc71a00747533438ca4587ba237f))
* **placeholders:** add warning when placeholder creation is enabled without respective filtered hub ([6709810](https://github.com/agregarr/agregarr/commit/670981060180a1a04ce75ecce934e233bd107372))
* **placeholders:** add youtube-cookies.txt setup feedback ([3f49633](https://github.com/agregarr/agregarr/commit/3f49633027091ec1fefcc045a7d882ce624ee945))
* **placeholders:** ensure movie placeholder parent folders are deleted on cleanup ([9395447](https://github.com/agregarr/agregarr/commit/9395447089ff3948d48ff35886e394f6e82a7333))
* **placeholders:** ensure placeholder days ahead is respected for non-coming soon collections ([e2ebf90](https://github.com/agregarr/agregarr/commit/e2ebf90db4e6a7bbb2e9e34e00789793e3c6f19e)), closes [#253](https://github.com/agregarr/agregarr/issues/253) [#268](https://github.com/agregarr/agregarr/issues/268)
* **placeholders:** handle Jellyfin trickplay directories during cleanup ([#340](https://github.com/agregarr/agregarr/issues/340)) ([5806bbc](https://github.com/agregarr/agregarr/commit/5806bbc549aa7af283292b47a2702160c9afa035))
* **placeholders:** improve date filtering UX/logic for general lists ([f124211](https://github.com/agregarr/agregarr/commit/f124211bda12581d7e71541f4a5209ad92093a3f)), closes [#336](https://github.com/agregarr/agregarr/issues/336) [#268](https://github.com/agregarr/agregarr/issues/268) [#253](https://github.com/agregarr/agregarr/issues/253) [#307](https://github.com/agregarr/agregarr/issues/307)
* **placeholders:** trigger Plex scan and empty trash after cleanup ([#332](https://github.com/agregarr/agregarr/issues/332)) ([452a2be](https://github.com/agregarr/agregarr/commit/452a2be4a986a2a41d17090bfda1c5809207aa84))
* **placeholders:** update to new library specific path ([b381e41](https://github.com/agregarr/agregarr/commit/b381e419e687ca2eeced5ad4219728ed126a8aed))
* **plex-libraries:** fixes non-movie/show libraries being discovered inconsistently ([8073c34](https://github.com/agregarr/agregarr/commit/8073c3418c040799e56b19ceae034c5f0692f844)), closes [#255](https://github.com/agregarr/agregarr/issues/255)
* **plex:** handle 404 gracefully when deleting hub items ([#356](https://github.com/agregarr/agregarr/issues/356)) ([287befa](https://github.com/agregarr/agregarr/commit/287befaa5092127fc9edb335ef5c5c487f1c0068))
* **posters:** validate SVG icon dimensions and file type ([#350](https://github.com/agregarr/agregarr/issues/350)) ([be53722](https://github.com/agregarr/agregarr/commit/be53722678b8fcdd8846debc6756ef56d80c87c9))
* **random-lists:** fixes letterboxd and imdb random lists ([76db41b](https://github.com/agregarr/agregarr/commit/76db41b2ac31ad605b938815e8348b252c2fded3)), closes [#324](https://github.com/agregarr/agregarr/issues/324)
* **rt-ratings:** add roman numeral search support ([#334](https://github.com/agregarr/agregarr/issues/334)) ([7b21871](https://github.com/agregarr/agregarr/commit/7b2187108da99ef96639f1365a373764b3c138c5))
* **rt-ratings:** fix year and title case mismatch ([33ac103](https://github.com/agregarr/agregarr/commit/33ac1038951558da4367ad644c0bf20660a0309e)), closes [#289](https://github.com/agregarr/agregarr/issues/289)
* **scheduler:** startNow immediate sync and deadlock bugs ([#348](https://github.com/agregarr/agregarr/issues/348)) ([bcda04d](https://github.com/agregarr/agregarr/commit/bcda04dc64fb5dad7768602e8de2aca718934802))
* **security:** harden API clients and file operations ([#300](https://github.com/agregarr/agregarr/issues/300)) ([7c6ff6b](https://github.com/agregarr/agregarr/commit/7c6ff6b0304ee32ca3833516af9e7a4af345552c))
* **trakt:** add support for new app.trakt.tv urls ([193833c](https://github.com/agregarr/agregarr/commit/193833ce850b750df59a1c8f2816a067a2a17c7c))


### Features

* **imdb:** add Top 250 English Movies collection type ([#358](https://github.com/agregarr/agregarr/issues/358)) ([01f94d5](https://github.com/agregarr/agregarr/commit/01f94d5c1fc94adb85c22cd621bbb947f8c06054)), closes [agregarr/agregarr#330](https://github.com/agregarr/agregarr/issues/330)
* **overlays:** add certified fresh overlay support, with preset ([b3f0a1e](https://github.com/agregarr/agregarr/commit/b3f0a1e561ae979065cc15eb784ccb780c0c2dfe)), closes [#346](https://github.com/agregarr/agregarr/issues/346)
* **overlays:** add daysSinceAdded and daysSinceLastPlayed variables ([d32c041](https://github.com/agregarr/agregarr/commit/d32c041faff801e741a5e36a01cf4f667156e2c5)), closes [#315](https://github.com/agregarr/agregarr/issues/315)
* **overlays:** add exists (null) boolean condition ([15d343e](https://github.com/agregarr/agregarr/commit/15d343e8eeefaaeca9a2b256debb227eb49adbb4)), closes [#285](https://github.com/agregarr/agregarr/issues/285)
* **overlays:** add Plex User Rating condition/variable ([3aadbf0](https://github.com/agregarr/agregarr/commit/3aadbf0b443b500dc538415a9f1068aeaa046ccf)), closes [#254](https://github.com/agregarr/agregarr/issues/254)
* **overlays:** add Radarr/Sonarr tag support for overlay conditions ([#276](https://github.com/agregarr/agregarr/issues/276)) ([cc9dc82](https://github.com/agregarr/agregarr/commit/cc9dc828d192d26b1fc72709c2130b537824c984)), closes [#272](https://github.com/agregarr/agregarr/issues/272)
* **placeholders:** add option to skip youtube trailer downloads ([39c439b](https://github.com/agregarr/agregarr/commit/39c439bb80c9e98fa1c3713b2567d81fa039451f))
* **placeholders:** placeholder folders can now be created per-library ([fecdfb8](https://github.com/agregarr/agregarr/commit/fecdfb8bbaeb0bc7bc84bd66ee654d29ee9d8f0c)), closes [#251](https://github.com/agregarr/agregarr/issues/251) [#252](https://github.com/agregarr/agregarr/issues/252)
* **sort-order:** add release date and date added to plex as sort order options ([1c21a0e](https://github.com/agregarr/agregarr/commit/1c21a0e7b21d08ae42b68f2ae0d9698856c3515c)), closes [#187](https://github.com/agregarr/agregarr/issues/187) [#203](https://github.com/agregarr/agregarr/issues/203)


### Performance Improvements

* **overlays:** add TMDB poster caching and fix race conditions ([#277](https://github.com/agregarr/agregarr/issues/277)) ([3759140](https://github.com/agregarr/agregarr/commit/37591405efeef38e83dd254670641014bc189ee2))

# [2.1.0](https://github.com/agregarr/agregarr/compare/v2.0.0...v2.1.0) (2026-01-02)


### Bug Fixes

* **api:** fix caching of api clients causing settings to not reflect in sync ([553e99a](https://github.com/agregarr/agregarr/commit/553e99a8a08fecfcbf2825a292208c5eb079a3cd))
* **badges:** extract badge data to common component, add placeholder creation badge ([3c4ca7c](https://github.com/agregarr/agregarr/commit/3c4ca7c64c9186b2dd6cf9b69e0cf161e774bce0))
* **collection config:** prevents closing form when clicking outside of modal ([82a04d3](https://github.com/agregarr/agregarr/commit/82a04d33fec6e2cfe3a91532d64ce9b8f6db275c)), closes [#237](https://github.com/agregarr/agregarr/issues/237)
* **config:** fix incorrect variable check ([9cbc3b5](https://github.com/agregarr/agregarr/commit/9cbc3b594a09eb996e2693da5d21724b991cb71b))
* **debug:** add export for config data ([31098b2](https://github.com/agregarr/agregarr/commit/31098b2b1c81855865df9c19f1f1afb48e0e3cf5))
* **filtered hubs:** adds recently released episodes filtered hub ([5b0023d](https://github.com/agregarr/agregarr/commit/5b0023de6812160cf31101f860b990461e91130e))
* **imdb:** fix tvMovie media type being categorised as tv ([162926a](https://github.com/agregarr/agregarr/commit/162926a7985370ed458d2fe954cd6c4b20a559f3)), closes [#229](https://github.com/agregarr/agregarr/issues/229)
* **item order:** fixes item ordering in plex collections ([8c94464](https://github.com/agregarr/agregarr/commit/8c94464c17339b420e0446535e30bf4ed8484f38)), closes [#225](https://github.com/agregarr/agregarr/issues/225)
* **job scheduling:** fixes cron parsing for following execution time ([7f0962e](https://github.com/agregarr/agregarr/commit/7f0962e5fe4ecafa2f913e87db44e6510e2cda23))
* **language:** add Hungarian as language option (locale and TMDB) ([464825d](https://github.com/agregarr/agregarr/commit/464825d28c19c94e9f9d1e3484ae46de7b70c9e1))
* **library:** fixes promotion/demotion not working for agregarr collections ([7d96b52](https://github.com/agregarr/agregarr/commit/7d96b52f2578ac7d458bd83b8407a8a5d19e2ad7)), closes [#207](https://github.com/agregarr/agregarr/issues/207)
* **migration:** moves app migration to inline typeORM ([f2e310d](https://github.com/agregarr/agregarr/commit/f2e310dc98be14086f463292a04f0d3f353f49d0)), closes [#215](https://github.com/agregarr/agregarr/issues/215)
* **missing item filtering:** fixes country/language exclusions ([74e4dab](https://github.com/agregarr/agregarr/commit/74e4dabe497734c9b5b1888190925d5a473b950c)), closes [#262](https://github.com/agregarr/agregarr/issues/262)
* **missing items filtering:** adds RT audience as missing item filter ([424c8f2](https://github.com/agregarr/agregarr/commit/424c8f2347efc3bbc52cf79fbb1bbebc8b97feb9)), closes [#246](https://github.com/agregarr/agregarr/issues/246)
* **multi source:** fixes incorrect library type ([4bcd1cc](https://github.com/agregarr/agregarr/commit/4bcd1cc2c13d2c724d69f8c5e7a91ea72b3b0b16))
* **networks:** fix parsing of hyphenated lists ([f4acd17](https://github.com/agregarr/agregarr/commit/f4acd171441dabd73fb40ed2b6e4af51ec5f860f)), closes [#259](https://github.com/agregarr/agregarr/issues/259) [#263](https://github.com/agregarr/agregarr/issues/263)
* **networks:** fixes multi-source networks not showing in preview ([173b353](https://github.com/agregarr/agregarr/commit/173b35358b658ba4c1c9ffaa9d487d8fcfdfa824)), closes [#209](https://github.com/agregarr/agregarr/issues/209)
* **overlay editor:** add text opacity for overlays ([c5af8b4](https://github.com/agregarr/agregarr/commit/c5af8b422638b1468015d78ffef2bda06b0533ca))
* **overlays job:** migrate old default job to 3am default to avoid conflitc with collections sync ([5640152](https://github.com/agregarr/agregarr/commit/56401528592886c8120fa1db1f3087b60d773fcb))
* **overlays:** add backend support for DoVi, add preset for HDR and DoVi ([b2e645b](https://github.com/agregarr/agregarr/commit/b2e645bc95cad2b09952f9e2989edf6e2503e8a2)), closes [#183](https://github.com/agregarr/agregarr/issues/183)
* **overlays:** add date formatting options for nextSeasonAirDate ([ea2d07b](https://github.com/agregarr/agregarr/commit/ea2d07b74a6f55ef7ff142d6808dda038d968001)), closes [#231](https://github.com/agregarr/agregarr/issues/231)
* **overlays:** add further date formats ([7b56890](https://github.com/agregarr/agregarr/commit/7b568909e5c836f4fcfa6172f98a6e5c8ab9b201)), closes [#216](https://github.com/agregarr/agregarr/issues/216)
* **overlays:** add support for various plex url formats ([22653c9](https://github.com/agregarr/agregarr/commit/22653c9b212a373d92a472a0245a5d3559c3d004))
* **overlays:** adds condition for gap in awaiting download preset template ([192ed95](https://github.com/agregarr/agregarr/commit/192ed954f82181218f4a695101dfe717a7eb3576))
* **overlays:** enable per library overlays sync ([57e3c5a](https://github.com/agregarr/agregarr/commit/57e3c5a8044647cb27c008b8ec8ad235556cc02e)), closes [#218](https://github.com/agregarr/agregarr/issues/218)
* **overlays:** ensure poster is locked ([136d0e9](https://github.com/agregarr/agregarr/commit/136d0e92f3a1190d9c1f977696dbdaac0be17977))
* **overlays:** fix some variables not having correct operators ([73984f0](https://github.com/agregarr/agregarr/commit/73984f0961eaed418523b2c6a3b67d624b3a88ca)), closes [#211](https://github.com/agregarr/agregarr/issues/211)
* **overlays:** fix spaces in plex search query ([31b2650](https://github.com/agregarr/agregarr/commit/31b2650648565f685c9c45c08349a1cff8fedd10)), closes [#217](https://github.com/agregarr/agregarr/issues/217)
* **overlays:** fixes operator not updating when changing condition ([4c066b3](https://github.com/agregarr/agregarr/commit/4c066b33fcfba73a2ab454b881059fbc3d6bf744)), closes [#210](https://github.com/agregarr/agregarr/issues/210)
* **overlays:** update coming soon preset to include upcoming seasons ([c581536](https://github.com/agregarr/agregarr/commit/c581536745dc1cf2f6af878a29e25d30db09e2d2))
* **overseerr:** fixes radarr/sonarr settings not being avaialable when only a single server is setup ([f579260](https://github.com/agregarr/agregarr/commit/f5792601bc873a98fba08a65b22feaa104151b19)), closes [#154](https://github.com/agregarr/agregarr/issues/154)
* **placeholders:** ensure placeholders are cleaned up in various scenarios ([788371c](https://github.com/agregarr/agregarr/commit/788371c0f03119fa20ce42729590143c6eafa24d))
* **placeholders:** extract placeholder functions, refactor sources, overlays fixes ([4900554](https://github.com/agregarr/agregarr/commit/4900554cc184b81df257b1940d377776cc8919b2))
* **placeholders:** fix incorrect parsing of path from plex ([2cb7d07](https://github.com/agregarr/agregarr/commit/2cb7d07c91eebf73febea92a092a505794d508f4))
* **placeholders:** fix placeholders being deleted incorrectly ([10a43af](https://github.com/agregarr/agregarr/commit/10a43afd0b7c638745689f69346564cd70179976))
* **placeholders:** fixes Days Ahead not being respected ([c30692c](https://github.com/agregarr/agregarr/commit/c30692ce0cfc6af5c5420db11b06164d1721b4d4)), closes [#253](https://github.com/agregarr/agregarr/issues/253) [#268](https://github.com/agregarr/agregarr/issues/268)
* **plex libraries:** improved error handling. remove dual update paths ([691ae05](https://github.com/agregarr/agregarr/commit/691ae055f8f1893717fc54416b100bb7b1e82d0b)), closes [#255](https://github.com/agregarr/agregarr/issues/255)
* **posters:** add custom fonts support ([02999ac](https://github.com/agregarr/agregarr/commit/02999acad6645b52e497ee2ae939e4d2542758b4)), closes [#219](https://github.com/agregarr/agregarr/issues/219)
* **root folder:** add home button to go to root ([bc630a7](https://github.com/agregarr/agregarr/commit/bc630a759e7c622a8d4933e59ef79e6a89e2b89c))
* **sync:** ensure individual sync does not run concurrently with main sync ([b911590](https://github.com/agregarr/agregarr/commit/b911590fdf0700435526240b473448b117a740b6))
* **sync:** prevent collections sync and overlays sync running concurrently ([376d83c](https://github.com/agregarr/agregarr/commit/376d83c1a2784eaa4b29f46ace5768f29b2f70ab))
* **tautulli:** fixes changes to tautulli minimum plays not being respected ([3eeaf27](https://github.com/agregarr/agregarr/commit/3eeaf2704c036c774db1e724b1fcee4a74c7674f))
* **titles:** fix some title variables not working correctly ([0bcd709](https://github.com/agregarr/agregarr/commit/0bcd709a806168efe0579e4e8767fb29c0e08c5e))
* **tmdb auto-franchise:** add grab missing item ([b2b7e3f](https://github.com/agregarr/agregarr/commit/b2b7e3f3f349e340dbbb185571fcb4074ae30469)), closes [#205](https://github.com/agregarr/agregarr/issues/205)
* **tmdb posters:** language option can now be selected per-library ([a3fec40](https://github.com/agregarr/agregarr/commit/a3fec4027f184208e0327e944285964e7647eed1)), closes [#220](https://github.com/agregarr/agregarr/issues/220)


### Features

* **internationalisation:** enable language picker and first few languages ([ad0e964](https://github.com/agregarr/agregarr/commit/ad0e96400cf7f109a752daad69d6cde69a5a11f7))
* **overlays:** add overlays test modal, allowing testing of indivdual items ([6333c1a](https://github.com/agregarr/agregarr/commit/6333c1a7a53e49c1a4f2ae42e30c70971cba0860)), closes [#212](https://github.com/agregarr/agregarr/issues/212)
* **overlays:** add support for overlays based on maintainerr action ([858f793](https://github.com/agregarr/agregarr/commit/858f7934a602bb2b9b528c3e2e237b86476d3394)), closes [#233](https://github.com/agregarr/agregarr/issues/233)
* **sources:** add actor and director collections with seperators ([#198](https://github.com/agregarr/agregarr/issues/198)) ([f91b7fa](https://github.com/agregarr/agregarr/commit/f91b7faa804c9c0a49e4733f405bafbe70a44f16))

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
