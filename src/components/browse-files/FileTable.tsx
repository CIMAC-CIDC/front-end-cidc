import React from "react";
import { DataFile } from "../../model/file";
import { LOCALE, DATE_OPTIONS } from "../../util/constants";
import { colors } from "../../rootStyles";
import PaginatedTable, { IHeader } from "../generic/PaginatedTable";
import {
    makeStyles,
    TableCell,
    Button,
    Grid,
    Box,
    Typography,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions
} from "@material-ui/core";
import { filterConfig, Filters } from "./FileFilter";
import { useQueryParams, useQueryParam, NumberParam } from "use-query-params";
import { getFiles, IDataWithMeta, getFilelist } from "../../api/api";
import { withIdToken } from "../identity/AuthProvider";
import MuiRouterLink from "../generic/MuiRouterLink";
import axios, { CancelTokenSource } from "axios";
import filesize from "filesize";
import ReactMarkdown from "react-markdown";

const fileQueryDefaults = {
    page_size: 15
    // // Columns to omit from `getFiles` queries.
    // // These columns may contain large JSON blobs
    // // that would slow the query down.
    // projection: {
    //     clustergrammer: 0,
    //     additional_metadata: 0
    // }
};

const useStyles = makeStyles({
    root: {
        "& .MuiTable-root": {
            border: `1px solid ${colors.LIGHT_GREY}`,
            borderRadius: 5,
            borderCollapse: "separate"
        },
        "& .MuiTableRow-root": {
            cursor: "pointer"
        }
    },
    checkbox: {
        padding: 0
    },
    checkboxCell: {
        paddingRight: 0
    }
});

export interface IFileTableProps {
    history: any;
}

export const filterParams = (filters: Filters) => {
    return {
        trial_ids: filters.trial_ids?.join(","),
        facets: filters.facets?.join(",")
    };
};

export const sortParams = (header?: IHeader) => {
    return (
        header && {
            sort_field: header?.key,
            sort_direction: header?.direction
        }
    );
};

const BatchDownloadButton: React.FC<{
    ids: number[];
    token: string;
    clearIds: () => void;
}> = ({ ids, token, clearIds }) => {
    const [openDialog, setOpenDialog] = React.useState<boolean>(false);

    const filePluralized = `file${ids.length > 1 ? "s" : ""}`;

    return (
        <Grid container spacing={1}>
            <Grid item>
                <Button
                    variant="contained"
                    color="primary"
                    disabled={ids.length === 0}
                    disableRipple
                    onClick={() => {
                        setOpenDialog(true);
                    }}
                >
                    {ids.length > 0
                        ? `Download ${ids.length} ${filePluralized}`
                        : "No files selected"}
                </Button>
            </Grid>
            {ids.length > 0 && (
                <Grid item>
                    <Button variant="outlined" onClick={() => clearIds()}>
                        Clear Selection
                    </Button>
                </Grid>
            )}
            <Dialog open={openDialog} onClose={() => setOpenDialog(false)}>
                <DialogTitle>
                    Batch download{" "}
                    <strong>
                        {ids.length} {filePluralized}
                    </strong>
                </DialogTitle>
                <DialogContent>
                    <ReactMarkdown
                        className="markdown-body"
                        source={[
                            `Download the "filelist.tsv" file for this file batch, and run this command in the desired download directory:`,
                            "```bash",
                            "cat filelist.tsv | xargs -n 2 -P 8 gsutil cp",
                            "```",
                            "If you haven't logged in with `gcloud` recently, you'll need to run `gcloud auth login` first.",
                            "",
                            "This command requires a [`gsutil`](https://cloud.google.com/storage/docs/gsutil_install) installation and a shell that supports `cat` and `xargs`.",
                            "",
                            "Note: Batch downloads are resumable. If you cancel an ongoing download (e.g., using control+c), you can resume that download by rerunning the download command."
                        ].join("\n")}
                    />
                </DialogContent>
                <DialogActions>
                    <Grid container justify="space-between">
                        <Grid item>
                            <Button onClick={() => setOpenDialog(false)}>
                                Cancel
                            </Button>
                        </Grid>
                        <Grid item>
                            <Button
                                color="primary"
                                variant="contained"
                                onClick={() => {
                                    getFilelist(token, ids).then(blob => {
                                        const url = URL.createObjectURL(blob);
                                        const a = document.createElement("a");
                                        a.href = url;
                                        a.download = "filelist.tsv";
                                        document.body.appendChild(a);
                                        a.click();
                                        URL.revokeObjectURL(url);
                                    });
                                }}
                            >
                                Download Filelist.tsv
                            </Button>
                        </Grid>
                    </Grid>
                </DialogActions>
            </Dialog>
        </Grid>
    );
};

const CANCEL_MESSAGE = "cancelling stale filter request";

const FileTable: React.FC<IFileTableProps & { token: string }> = props => {
    const classes = useStyles();
    const axiosCanceller = React.useRef<CancelTokenSource | undefined>();

    const filters = useQueryParams(filterConfig)[0];

    const [maybeQueryPage, setQueryPage] = useQueryParam("page", NumberParam);
    const queryPage = maybeQueryPage || 0;
    const [tablePage, setTablePage] = React.useState<number>(0);
    const [prevPage, setPrevPage] = React.useState<number | null>();

    const [data, setData] = React.useState<
        IDataWithMeta<DataFile[]> | undefined
    >(undefined);
    const [selectedFileIds, setSelectedFileIds] = React.useState<number[]>([]);

    const [headers, setHeaders] = React.useState<IHeader[]>([
        {
            key: "object_url",
            label: "File Name"
        },
        {
            key: "trial_id",
            label: "Protocol ID"
        },
        { key: "file_ext", label: "Format" },
        { key: "data_category", label: "Category" },
        {
            key: "file_size_bytes",
            label: "Size"
        },
        {
            key: "uploaded_timestamp",
            label: "Date/Time Uploaded",
            active: true,
            direction: "desc"
        } as IHeader
    ]);
    const sortHeader = headers.find(h => h.active);

    React.useEffect(() => {
        if (queryPage === prevPage && prevPage !== 0) {
            // Reset the query page to 0, since the user has either
            // changed the filtering or the sorting.
            // NOTE: This change doesn't update the file table.
            setQueryPage(0);
        } else if (queryPage < 0) {
            // A negative queryPage is invalid
            setQueryPage(0);
        } else {
            // Clear existing data, so the table shows a loading indicator
            setData(undefined);

            // Cancel the previous request, if one is ongoing
            if (axiosCanceller.current) {
                axiosCanceller.current.cancel(CANCEL_MESSAGE);
            }

            axiosCanceller.current = axios.CancelToken.source();

            getFiles(
                props.token,
                {
                    page_num: queryPage,
                    ...filterParams(filters),
                    ...sortParams(sortHeader),
                    ...fileQueryDefaults
                },
                axiosCanceller.current.token
            )
                .then(files => {
                    // Check if queryPage is too high for the current filters.
                    if (
                        queryPage * fileQueryDefaults.page_size >
                        files.meta.total
                    ) {
                        // queryPage is out of bounds, so reset to 0.
                        setQueryPage(0);
                    } else {
                        // Update the page in the file table.
                        setTablePage(queryPage);

                        // Push the new data to the table.
                        setData(files);
                    }
                })
                .catch(err => {
                    if (err.message !== CANCEL_MESSAGE) {
                        console.error(err.message);
                    }
                });
        }
        // Track which page we're switching from.
        setPrevPage(queryPage);

        // If we include prevPage in the useEffect dependencies, this
        // effect will rerun until queryPage == prevPage, preventing
        // the component from remaining in a state where queryPage != 0.
        // TODO: maybe there's a refactor that prevents this issue.
        // eslint-disable-next-line
    }, [props.token, filters, sortHeader, queryPage, setQueryPage]);

    const formatObjectURL = (row: DataFile) => {
        const paths = row.object_url.split("/");
        const fileName = paths[paths.length - 1];
        const prefix = paths.slice(0, paths.length - 1).join("/");
        return (
            <MuiRouterLink to={`/browse-files/${row.id}`}>
                <div style={{ textDecoration: "underline" }}>
                    <div>{prefix}/</div>
                    <div>{fileName}</div>
                </div>
            </MuiRouterLink>
        );
    };

    const formatUploadTimestamp = (row: DataFile) =>
        new Date(row.uploaded_timestamp).toLocaleString(LOCALE, DATE_OPTIONS);

    return (
        <div className={classes.root}>
            <Grid container direction="column" spacing={1}>
                <Grid item>
                    <Grid container spacing={1}>
                        <Grid item>
                            <Box margin={1}>
                                <Typography
                                    color="textSecondary"
                                    variant="caption"
                                >
                                    Select files for batch download
                                </Typography>
                            </Box>
                        </Grid>
                        <Grid item>
                            <BatchDownloadButton
                                ids={selectedFileIds}
                                token={props.token}
                                clearIds={() => setSelectedFileIds([])}
                            />
                        </Grid>
                    </Grid>
                </Grid>
                <Grid item>
                    <PaginatedTable
                        count={data ? data.meta.total : 0}
                        page={tablePage}
                        onChangePage={p => setQueryPage(p)}
                        rowsPerPage={fileQueryDefaults.page_size}
                        headers={headers}
                        data={data && data.data}
                        getRowKey={row => row.id}
                        renderRowContents={row => {
                            return (
                                <>
                                    <TableCell>
                                        {formatObjectURL(row)}
                                    </TableCell>
                                    <TableCell>{row.trial_id}</TableCell>
                                    <TableCell>{row.file_ext}</TableCell>
                                    <TableCell>{row.data_category}</TableCell>
                                    <TableCell>
                                        {filesize(row.file_size_bytes)}
                                    </TableCell>
                                    <TableCell>
                                        {formatUploadTimestamp(row)}
                                    </TableCell>
                                </>
                            );
                        }}
                        selectedRowIds={selectedFileIds}
                        setSelectedRowIds={setSelectedFileIds}
                        onClickRow={file => {
                            const newSelectedFileIds = selectedFileIds.includes(
                                file.id
                            )
                                ? selectedFileIds.filter(id => id !== file.id)
                                : [...selectedFileIds, file.id];
                            setSelectedFileIds(newSelectedFileIds);
                        }}
                        onClickHeader={header => {
                            const newHeaders = headers.map(h => {
                                const newHeader = { ...h };
                                if (h.key === header.key) {
                                    if (h.active) {
                                        newHeader.direction =
                                            h.direction === "desc"
                                                ? "asc"
                                                : "desc";
                                    } else {
                                        newHeader.active = true;
                                        newHeader.direction = "desc";
                                    }
                                } else {
                                    newHeader.active = false;
                                }
                                return newHeader;
                            });
                            setHeaders(newHeaders);
                        }}
                    />
                </Grid>
            </Grid>
        </div>
    );
};

export default withIdToken<IFileTableProps>(FileTable);