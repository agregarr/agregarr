import type { CollectionFormConfig } from '@app/types/collections';
import { ErrorMessage, Field, type FormikErrors } from 'formik';
import { useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';

const messages = defineMessages({
  customTraktListUrl: 'Custom Trakt List URL',
  customTmdbCollectionUrl: 'Custom TMDb Collection URL',
  customImdbListUrl: 'Custom IMDb List URL',
  customLetterboxdListUrl: 'Custom Letterboxd List URL',
  customMdblistListUrl: 'Custom MDBList List URL',
  fetchTitle: 'Validate',
  fetching: 'Fetching...',
  fetchedTitle: 'Fetched Title',
  enterUrl: 'Enter URL...',
  urlRequired: 'URL is required for custom lists',
  validUrl: 'Please enter a valid URL',
});

interface CustomUrlSectionProps {
  values: CollectionFormConfig;
  setFieldValue: (
    field: string,
    value: string | number | boolean | string[] | object | null
  ) => void;
  errors: FormikErrors<CollectionFormConfig>;
  fetchTraktTitle?: (
    url: string,
    setFieldValue?: (field: string, value: string) => void
  ) => Promise<void>;
  fetchTmdbTitle?: (
    url: string,
    setFieldValue?: (field: string, value: string) => void
  ) => Promise<void>;
  fetchImdbTitle?: (
    url: string,
    setFieldValue?: (field: string, value: string) => void
  ) => Promise<void>;
  fetchLetterboxdTitle?: (
    url: string,
    setFieldValue?: (field: string, value: string) => void
  ) => Promise<void>;
  fetchMdblistTitle?: (
    url: string,
    setFieldValue?: (field: string, value: string) => void
  ) => Promise<void>;
}

const CustomUrlSection = ({
  values,
  setFieldValue,
  fetchTraktTitle,
  fetchTmdbTitle,
  fetchImdbTitle,
  fetchLetterboxdTitle,
  fetchMdblistTitle,
}: CustomUrlSectionProps) => {
  const intl = useIntl();
  const [isLoadingTitle, setIsLoadingTitle] = useState({
    trakt: false,
    mdblist: false,
    tmdb: false,
    imdb: false,
    letterboxd: false,
  });

  const handleFetchTitle = async (
    type: 'trakt' | 'tmdb' | 'imdb' | 'letterboxd' | 'mdblist'
  ) => {
    const urlField = `${type}CustomListUrl`;
    const url = String((values as Record<string, unknown>)[urlField] || '');

    if (!url) return;

    setIsLoadingTitle((prev) => ({ ...prev, [type]: true }));

    try {
      if (type === 'trakt' && fetchTraktTitle) {
        await fetchTraktTitle(url, setFieldValue);
      } else if (type === 'tmdb' && fetchTmdbTitle) {
        await fetchTmdbTitle(url, setFieldValue);
      } else if (type === 'imdb' && fetchImdbTitle) {
        await fetchImdbTitle(url, setFieldValue);
      } else if (type === 'letterboxd' && fetchLetterboxdTitle) {
        await fetchLetterboxdTitle(url, setFieldValue);
      } else if (type === 'mdblist' && fetchMdblistTitle) {
        await fetchMdblistTitle(url, setFieldValue);
      }
    } finally {
      setIsLoadingTitle((prev) => ({ ...prev, [type]: false }));
    }
  };

  // Custom Trakt List URL
  if (values.type === 'trakt' && values.subtype === 'custom') {
    return (
      <div>
        <label
          htmlFor="traktCustomListUrl"
          className="mb-2 block text-sm text-gray-300"
        >
          {intl.formatMessage(messages.customTraktListUrl)}{' '}
          <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-2">
          <Field
            type="url"
            id="traktCustomListUrl"
            name="traktCustomListUrl"
            placeholder="https://trakt.tv/users/username/lists/listname or https://trakt.tv/lists/official/collection-name"
            className="flex-1 rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white placeholder-gray-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          {fetchTraktTitle && (
            <button
              type="button"
              onClick={() => handleFetchTitle('trakt')}
              disabled={!values.traktCustomListUrl || isLoadingTitle.trakt}
              className="whitespace-nowrap rounded-md bg-orange-600 px-3 py-2 text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoadingTitle.trakt
                ? intl.formatMessage(messages.fetching)
                : intl.formatMessage(messages.fetchTitle)}
            </button>
          )}
        </div>
        <ErrorMessage
          name="traktCustomListUrl"
          component="div"
          className="mt-1 text-sm text-red-500"
        />
        <p className="mt-1 text-xs text-gray-400">
          Examples: https://trakt.tv/users/username/lists/listname or
          https://trakt.tv/lists/official/jurassic-park-collection
        </p>
      </div>
    );
  }

  // Custom TMDb Collection URL
  if (values.type === 'tmdb' && values.subtype === 'custom') {
    return (
      <div>
        <label
          htmlFor="tmdbCustomListUrl"
          className="mb-2 block text-sm text-gray-300"
        >
          {intl.formatMessage(messages.customTmdbCollectionUrl)}{' '}
          <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-2">
          <Field
            type="url"
            id="tmdbCustomListUrl"
            name="tmdbCustomListUrl"
            placeholder="https://www.themoviedb.org/collection/12345"
            className="flex-1 rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white placeholder-gray-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          {fetchTmdbTitle && (
            <button
              type="button"
              onClick={() => handleFetchTitle('tmdb')}
              disabled={!values.tmdbCustomListUrl || isLoadingTitle.tmdb}
              className="whitespace-nowrap rounded-md bg-orange-600 px-3 py-2 text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoadingTitle.tmdb
                ? intl.formatMessage(messages.fetching)
                : intl.formatMessage(messages.fetchTitle)}
            </button>
          )}
        </div>
        <ErrorMessage
          name="tmdbCustomListUrl"
          component="div"
          className="mt-1 text-sm text-red-500"
        />
        <p className="mt-1 text-xs text-gray-400">
          Example: https://www.themoviedb.org/collection/12345-collection-name
        </p>
      </div>
    );
  }

  // Custom IMDb List URL
  if (values.type === 'imdb' && values.subtype === 'custom') {
    return (
      <div>
        <label
          htmlFor="imdbCustomListUrl"
          className="mb-2 block text-sm text-gray-300"
        >
          {intl.formatMessage(messages.customImdbListUrl)}{' '}
          <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-2">
          <Field
            type="url"
            id="imdbCustomListUrl"
            name="imdbCustomListUrl"
            placeholder="https://www.imdb.com/list/ls123456789/"
            className="flex-1 rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white placeholder-gray-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          {fetchImdbTitle && (
            <button
              type="button"
              onClick={() => handleFetchTitle('imdb')}
              disabled={!values.imdbCustomListUrl || isLoadingTitle.imdb}
              className="whitespace-nowrap rounded-md bg-orange-600 px-3 py-2 text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoadingTitle.imdb
                ? intl.formatMessage(messages.fetching)
                : intl.formatMessage(messages.fetchTitle)}
            </button>
          )}
        </div>
        <ErrorMessage
          name="imdbCustomListUrl"
          component="div"
          className="mt-1 text-sm text-red-500"
        />
        <p className="mt-1 text-xs text-gray-400">
          Example: https://www.imdb.com/list/ls123456789/ or
          https://www.imdb.com/user/ur12345678/lists/
        </p>
      </div>
    );
  }

  // Custom Letterboxd List URL
  if (values.type === 'letterboxd' && values.subtype === 'custom') {
    return (
      <div>
        <label
          htmlFor="letterboxdCustomListUrl"
          className="mb-2 block text-sm text-gray-300"
        >
          {intl.formatMessage(messages.customLetterboxdListUrl)}{' '}
          <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-2">
          <Field
            type="url"
            id="letterboxdCustomListUrl"
            name="letterboxdCustomListUrl"
            placeholder="https://letterboxd.com/username/list/listname/"
            className="flex-1 rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white placeholder-gray-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          {fetchLetterboxdTitle && (
            <button
              type="button"
              onClick={() => handleFetchTitle('letterboxd')}
              disabled={
                !values.letterboxdCustomListUrl || isLoadingTitle.letterboxd
              }
              className="whitespace-nowrap rounded-md bg-orange-600 px-3 py-2 text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoadingTitle.letterboxd
                ? intl.formatMessage(messages.fetching)
                : intl.formatMessage(messages.fetchTitle)}
            </button>
          )}
        </div>
        <ErrorMessage
          name="letterboxdCustomListUrl"
          component="div"
          className="mt-1 text-sm text-red-500"
        />
        <p className="mt-1 text-xs text-gray-400">
          Example: https://letterboxd.com/username/list/listname/
        </p>
      </div>
    );
  }

  // Custom MDBList List URL
  if (values.type === 'mdblist' && values.subtype === 'custom') {
    return (
      <div>
        <label
          htmlFor="mdblistCustomListUrl"
          className="mb-2 block text-sm text-gray-300"
        >
          {intl.formatMessage(messages.customMdblistListUrl)}{' '}
          <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-2">
          <Field
            type="url"
            id="mdblistCustomListUrl"
            name="mdblistCustomListUrl"
            placeholder="https://mdblist.com/lists/username/list-name"
            className="flex-1 rounded-md border border-stone-500 bg-stone-700 px-3 py-2 text-white placeholder-gray-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          {fetchMdblistTitle && (
            <button
              type="button"
              onClick={() => handleFetchTitle('mdblist')}
              disabled={!values.mdblistCustomListUrl || isLoadingTitle.mdblist}
              className="whitespace-nowrap rounded-md bg-orange-600 px-3 py-2 text-white hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoadingTitle.mdblist
                ? intl.formatMessage(messages.fetching)
                : intl.formatMessage(messages.fetchTitle)}
            </button>
          )}
        </div>
        <ErrorMessage
          name="mdblistCustomListUrl"
          component="div"
          className="mt-1 text-sm text-red-500"
        />
        <p className="mt-1 text-xs text-gray-400">
          Example: https://mdblist.com/lists/username/list-name
        </p>
      </div>
    );
  }

  return null;
};

export default CustomUrlSection;
