


# lib_BaseRow

This is the Baserow connector for Convertigo


For more technical informations : [documentation](./project.md)

- [Installation](#installation)
- [Sequences](#sequences)
    - [AdminLogin](#adminlogin)
    - [ApplicationsList](#applicationslist)
    - [FieldsList](#fieldslist)
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

Establishes a session with Baserow. Must be called befor any other API

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

### ApplicationsList

Lists all applications (databases) in baserow

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

## Mobile Library

Describes the mobile application global properties



