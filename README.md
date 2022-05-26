# clean-s3

Script which deletes unused files. It is intended to be copied into your project and run in repeated cycles (by using cron).

## File table requirements
- provided table has to have **primary key**
- provided table has to have **S3_CLEANUP_KEY_COLUMN** provided by *S3_CLEANUP_KEY_COLUMN_NAME* env
- provided table has to have ```deletedAt``` column
- provided table has to have **at least 1 association**

## Script consists of two parts
1. marking unused (unassociated) files for deletion (soft delete files in provided table in database)
   - script sets ```deletedAt``` timestamp to files which are not used to any record in any associated table
   - records in associated tables which are not (soft) deleted are considered as valid and therefore their files are not marked for deletion
   - count of these files is stored in **unused** variable in result
2. removing (marked for deletion) files from AWS S3 and database
   - this part is execued in serially processed chunks (1 chunk after another)
   - in 1 chunk iteration, there are execued these steps
     - 1000 files which were marked for deletion **before 30 days** are selected (1000 because it is limit for AWS S3 remove command)
     - ASW_S3_keys are extracted from these files
     - command to remove these AWS_S3_keys is send to AWS S3
     - count of removed files (in AWS S3) is stored in **removed** variable in result
     - errors from AWS S3 remove command are stored in **errors** variable in result
     - files, which were removed in AWS S3 are removed from database (hard delete)
     - if there are another chunks, they are processed next

>:warning:
><mark>There is no transaction used in script, so if it fails in any step, previously execued steps will remain execued</mark>
>:warning:

## Required environment variables
- *S3_CLEANUP_FILES_TABLE_NAME*
  - table name where files are stored
- *S3_CLEANUP_KEY_COLUMN_NAME*
  - column name which contains AWS_S3_key of file

## Optional environment variables
- *S3_CLEANUP_KEY_COLUMN_BASE*
  - if S3_CLEANUP_KEY_COLUMN value contains some prefix/postfix with the AWS_S3_key, it will be removed to extract only AWS_S3_key
  - for example if S3_CLEANUP_KEY_COLUMN value="**https://some-s3-url.com/5f69d9e42d89b290bd80ae8d_test.png**", you should set *S3_CLEANUP_KEY_COLUMN_BASE*="**https://some-s3-url.com/**" to extract AWS_S3_key="**5f69d9e42d89b290bd80ae8d_test.png**"
