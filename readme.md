


# lib_BaseRow

This is the Baserow connector for Convertigo. Use this connector to exchange data with Baserow databases.

## Symbols
This library uses the following symbols

| Symbol    | Usage |
|-----------|-------------------|
|lib_baserow.server  | the host name of the baserow server |
|lib_baserow.port    | the port baserow server, set to 443 for https, to 80 for http |
|lib_baserow.https   | set to true for https, to false otherwise |
|lib_baserow.password.secret| The baserow admin password |
|lib_baserow.adminuser| The baserow admin user email. |




For more technical informations : [documentation](./project.md)

- [Installation](#installation)
- [Sequences](#sequences)
    - [AdminLogin](#adminlogin)
    - [AdminUserCreate](#adminusercreate)
    - [AdminUserDelete](#adminuserdelete)
    - [ApplicationsList](#applicationslist)
    - [AssetFileUpload](#assetfileupload)
    - [DatabaseTokenCreate](#databasetokencreate)
    - [DatabaseTokenDelete](#databasetokendelete)
    - [FieldsList](#fieldslist)
    - [formssource_GetSelectData](#formssource_getselectdata)
    - [formssource_GetTableData](#formssource_gettabledata)
    - [FSPullAndPushTable](#fspullandpushtable)
    - [GroupsList](#groupslist)
    - [TableBulkExportToCSV](#tablebulkexporttocsv)
    - [TableBulkExportWaitFInished](#tablebulkexportwaitfinished)
    - [TableBulkImportFromCSV](#tablebulkimportfromcsv)
    - [TableCreateRow](#tablecreaterow)
    - [TableCreateRowApiKey](#tablecreaterowapikey)
    - [TableDeleteRow](#tabledeleterow)
    - [TableGetData](#tablegetdata)
    - [TableReadRow](#tablereadrow)
    - [TokenGetOrRefresh](#tokengetorrefresh)
- [Mobile Library](#mobile-library)


## Installation

1. In your Convertigo Studio use `File->Import->Convertigo->Convertigo Project` and hit the `Next` button
2. In the dialog `Project remote URL` field, paste the text below:
   <table>
     <tr><td>Usage</td><td>Click the copy button</td></tr>
     <tr><td>To contribute</td><td>

     ```
     lib_BaseRow=https://github.com/convertigo/c8oprj-lib-baserow.git:branch=master
     ```
     </td></tr>
     <tr><td>To simply use</td><td>

     ```
     lib_BaseRow=https://github.com/convertigo/c8oprj-lib-baserow/archive/master.zip
     ```
     </td></tr>
    </table>
3. Click the `Finish` button. This will automatically import the __lib_BaseRow__ project


## Sequences

### AdminLogin

Establishes a session with Baserow. Must be called before any other API

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>email</td><td>The Base row admin email</td>
</tr>
<tr>
<td>password</td><td>The baserow admin password</td>
</tr>
</table>

### AdminUserCreate

Create a user

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>email</td><td></td>
</tr>
<tr>
<td>language</td><td></td>
</tr>
<tr>
<td>name</td><td></td>
</tr>
<tr>
<td>password</td><td></td>
</tr>
</table>

### AdminUserDelete

Delete a User

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>user_id</td><td>The id of the user to delete</td>
</tr>
</table>

### ApplicationsList

Lists all applications (databases) in baserow

### AssetFileUpload

Uploads a file asset, the returned link can be used to be set as a value of a 'file' Type cell

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>apikey</td><td>The API Key</td>
</tr>
<tr>
<td>file</td><td>A File variable holding the path to the file to be uploaded</td>
</tr>
</table>

### DatabaseTokenCreate

Create a Token to acess databases within a group. This token will hold permissions to specific databases in the group

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>group_id</td><td>The ID of the group holding the databases to get a token to (Unique)</td>
</tr>
<tr>
<td>name</td><td>Token Name</td>
</tr>
</table>

### DatabaseTokenDelete

Delete a previously created Token by providing its id

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>token_id</td><td>Deletes the token related to the provided value.</td>
</tr>
</table>

### FieldsList

Lists all the fields in a baserow table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>table_id</td><td>Returns only the fields of the table related to the provided value.</td>
</tr>
</table>

### formssource_GetSelectData

Get data from a baserow table for a Select


**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>forms_config</td><td>Fills the select component from data with a given configuration. The first column will be the displayed item in the select, the second column will be the value of this item</td>
</tr>
<tr>
<td>forms_filter</td><td>Filters
</td>
</tr>
</table>

### formssource_GetTableData

Get data from a baserow table for a Grid


**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>forms_config</td><td>Returns the rows of the table with a given configuration</td>
</tr>
<tr>
<td>forms_tableFilter</td><td>Filters
</td>
</tr>
<tr>
<td>model</td><td>If true, just return one line of data so that No Code studio can compte the table model</td>
</tr>
</table>

### FSPullAndPushTable

Push a BaserowTable to FullSync for offline access

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>chunkSize</td><td></td>
</tr>
<tr>
<td>table_id</td><td>The table id to create and start an export job for</td>
</tr>
</table>

### GroupsList

Lists all Groups for the current user

### TableBulkExportToCSV

Exports a Table to CSV.. Export status must me monitored with the TableBulkExportWaitFinished sequence

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>table_id</td><td>The table id to create and start an export job for</td>
</tr>
</table>

### TableBulkExportWaitFInished

Wait for an export job to be finished. Will return the URL to the exported data

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>job_id</td><td>The job id to lookup information about.</td>
</tr>
</table>

### TableBulkImportFromCSV

Uploads a CSV to a table. 

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>chunkSize</td><td></td>
</tr>
<tr>
<td>files</td><td></td>
</tr>
<tr>
<td>fileSeparator</td><td></td>
</tr>
<tr>
<td>firstLineColumn</td><td></td>
</tr>
<tr>
<td>quoteChar</td><td></td>
</tr>
<tr>
<td>table_id</td><td></td>
</tr>
</table>

### TableCreateRow

Creates a row  in a table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>before</td><td>If provided then the newly created row will be positioned before the row with the provided id.</td>
</tr>
<tr>
<td>data</td><td>A JSON object with each field name and value</td>
</tr>
<tr>
<td>table_id</td><td>Insert row in this table_id</td>
</tr>
</table>

### TableCreateRowApiKey

Creates a row  in a table ising apikey instead of credentials

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>apikey</td><td></td>
</tr>
<tr>
<td>before</td><td>If provided then the newly created row will be positioned before the row with the provided id.</td>
</tr>
<tr>
<td>data</td><td>A JSON object with each field name and value</td>
</tr>
<tr>
<td>table_id</td><td>Insert row in this table_id</td>
</tr>
</table>

### TableDeleteRow

deletes a row from a  from a given table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>row_id</td><td>Deletes the row related to the value.</td>
</tr>
<tr>
<td>table_id</td><td>Returns the rows of the table related to the provided value.</td>
</tr>
</table>

### TableGetData

Gets data from a given table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>exclude</td><td>All the fields are included in the response by default. You can select a subset of fields by providing the exclude query parameter. If you for example provide the following GET parameter `exclude=field_1,field_2` then the fields with id `1` and id `2` are going to be excluded from the selection and response. If the `user_field_names` parameter is provided then instead exclude should be a comma separated list of the actual field names. For field names with commas you should surround the name with quotes like so: `exclude=My Field,"Field With , "`. A backslash can be used to escape field names which contain double quotes like so: `exclude=My Field,Field with \"`.</td>
</tr>
<tr>
<td>filterExpression</td><td>A JSON Structure representing the filters in the form :

```
{
	"mode": "AND",  // Can be AND or OR
	"filters": [
		{
			"field": "Name",  	// The name of the column to filter on
			"op": "contains",	// the operation, can be any of the operations described below
			"value": "Little"	// The value of the filter operation
		},
		{
			"field": "Description",
			"op": "contains",
			"value": "1954"
		}
	]
}
```

### operations

|Filter	|Example value	| Full example |
|-------|---------------|--------------|
|equal	|string	|field is 'string'|
|not_equal	|string	|field is not 'string'|
|date_equal	|2020-01-01	|field is date '2020-01-01'|
|date_not_equal	|2020-01-01	|field is not date '2020-01-01'|
|date_equals_today	|	|field is today|
|date_before_today	|	|field is before today|
|date_after_today	|	|field is after today|
|date_equals_days_ago	|Europe/Paris?1	|field is days ago 'Europe/Paris?1'|
|date_equals_months_ago	|Europe/Paris?1	|field is months ago 'Europe/Paris?1'|
|date_equals_years_ago	|Europe/Paris?1	|field is years ago 'Europe/Paris?1'|
|date_equals_week	|	|field in this week|
|date_equals_month	|	|field in this month|
|date_equals_year	|	|field in this year|
|date_equals_day_of_month|	1	|field day of month is '1'|
|date_before	|2020-01-01	|field is before date '2020-01-01'|
|date_after	|2020-01-01	|field is after date '2020-01-01'|
|contains	|string	|field contains 'string'|
|filename_contains|	string|	field filename contains 'string'|
|has_file_type|	image / document	|field has file type 'image / document'|
|contains_not 	string	|field contains not 'string'|
|length_is_lower_than	|5	|field length is lower than '5'|
|higher_than	|100|	field higher than '100'|
|lower_than	|100|	field lower than '100'|
|single_select_equal|	1	|field is '1'|
|single_select_not_equal|	1	|field is not '1'|
|boolean|	true|	field is 'true'|
|link_row_has|	1|	field has '1'|
|link_row_has_not|	1	|field has not '1'|
|link_row_contains|	string	|field contains 'string'|
|link_row_not_contains|	string|	field contains not 'string'|
|multiple_select_has|	1|	field has '1'|
|multiple_select_has_not|	1|	field has not '1'|
|empty|		|field is empty|
|not_empty|		|field is not empty|
</td>
</tr>
<tr>
<td>include_fields</td><td>All the fields are included in the response by default. You can select a subset of fields by providing the include query parameter. If you for example provide the following GET parameter `include=field_1,field_2` then only the fields withid `1` and id `2` are going to be selected and included in the response. If the `user_field_names` parameter is provided then instead include should be a comma separated list of the actual field names. For field names with commas you should surround the name with quotes like so: `include=My Field,"Field With , "`. A backslash can be used to escape field names which contain double quotes like so: `include=My Field,Field with \"`.</td>
</tr>
<tr>
<td>order_by</td><td>Optionally the rows can be ordered by provided field ids separated by comma. By default a field is ordered in ascending (A-Z) order, but by prepending the field with a '-' it can be ordered descending (Z-A). If the `user_field_names` parameter is provided then instead order_by should be a comma separated list of the actual field names. For field names with commas you should surround the name with quotes like so: `order_by=My Field,"Field With , "`. A backslash can be used to escape field names which contain double quotes like so: `order_by=My Field,Field with \"`.</td>
</tr>
<tr>
<td>page</td><td>Defines which page of rows should be returned.</td>
</tr>
<tr>
<td>search</td><td>If provided only rows with data that matches the search query are going to be returned.</td>
</tr>
<tr>
<td>size</td><td>Defines how many rows should be returned per page.</td>
</tr>
<tr>
<td>table_id</td><td>Returns the rows of the table related to the provided value.</td>
</tr>
<tr>
<td>view_id</td><td>Includes all the filters and sorts of the provided view.</td>
</tr>
</table>

### TableReadRow

Reads a row from a  from a given table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>row_id</td><td>Deletes the row related to the value.</td>
</tr>
<tr>
<td>table_id</td><td>Returns the rows of the table related to the provided value.</td>
</tr>
</table>

### TokenGetOrRefresh

Gets a token or refresh it if the token is expired the Token will be placed in the current user session

## Mobile Library

Describes the mobile application global properties



